import os
from flask import Flask, jsonify
from flask_cors import CORS
import numpy as np
import rasterio
from rasterio.warp import transform_bounds

app = Flask(__name__)
CORS(app)

TIFF_PATH = os.path.join(os.path.dirname(__file__), 'images', 'Pronostico_Agosto_TMin.tiff')

_CACHED_RASTER_DATA = None


def load_raster_data():
    """Load, transform, and cache the GeoTIFF raster data in memory."""
    global _CACHED_RASTER_DATA
    if _CACHED_RASTER_DATA is not None:
        return _CACHED_RASTER_DATA

    if not os.path.exists(TIFF_PATH):
        raise FileNotFoundError(f"TIFF file not found at: {TIFF_PATH}")

    with rasterio.open(TIFF_PATH) as dataset:
        data = dataset.read(1).astype(float)
        nodata = dataset.nodata

        if nodata is not None:
            data[data == nodata] = np.nan

        # Transform bounds to EPSG:4326 (WGS84 Lat/Lng) if needed
        if dataset.crs and dataset.crs.to_string() != 'EPSG:4326':
            wgs84_bounds = transform_bounds(dataset.crs, 'EPSG:4326', *dataset.bounds)
        else:
            wgs84_bounds = dataset.bounds

        # Vectorized data sanitization and rounding via NumPy
        invalid_mask = np.isnan(data) | np.isinf(data)
        rounded = np.round(data, 2)
        cleaned_data = np.where(invalid_mask, None, rounded).tolist()

        # Compute summary statistics on valid observations
        valid_cells = data[~invalid_mask]
        stats = {
            "min": round(float(np.min(valid_cells)), 2) if valid_cells.size else None,
            "max": round(float(np.max(valid_cells)), 2) if valid_cells.size else None,
            "mean": round(float(np.mean(valid_cells)), 2) if valid_cells.size else None,
        }

        _CACHED_RASTER_DATA = {
            "bounds": [
                [wgs84_bounds[1], wgs84_bounds[0]],  # [South, West]
                [wgs84_bounds[3], wgs84_bounds[2]],  # [North, East]
            ],
            "width": dataset.width,
            "height": dataset.height,
            "stats": stats,
            "data": cleaned_data,
        }

    return _CACHED_RASTER_DATA


# Pre-warm cache on application boot
try:
    load_raster_data()
except Exception as e:
    app.logger.warning("Could not pre-load TIFF on boot: %s", e)


@app.route('/api/raster-data')
def get_raster_data():
    try:
        payload = load_raster_data()
        return jsonify(payload)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": "Failed to process raster data", "details": str(e)}), 500


@app.route('/health')
@app.route('/')
def health_check():
    return jsonify({
        "status": "ok",
        "service": "geo-tiff-api",
        "raster_cached": _CACHED_RASTER_DATA is not None
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
