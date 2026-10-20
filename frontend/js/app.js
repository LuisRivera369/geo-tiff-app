document.addEventListener("DOMContentLoaded", () => {
  const loaderOverlay = document.getElementById("loader-overlay");
  const loadingText = document.getElementById("loading-text");
  const serverNotice = document.getElementById("server-notice");
  const retryBtn = document.getElementById("retry-btn");
  const loaderSpinner = document.getElementById("loader-spinner");

  const statsBadge = document.getElementById("stats-badge");
  const statMin = document.getElementById("stat-min");
  const statMean = document.getElementById("stat-mean");
  const statMax = document.getElementById("stat-max");

  // Dynamic API detection: local backend during local development, Render in production
  const API_BASE_URL =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
      ? "http://localhost:5000"
      :"https://luisrivera.pythonanywhere.com"
      /* : "https://app-geo-json-luis.onrender.com"; */

  // Base layers
  const esriStreets = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles &copy; Esri &mdash; World Street Map", maxZoom: 18 }
  );

  const esriSatellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles &copy; Esri &mdash; World Imagery", maxZoom: 18 }
  );

  const osm = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }
  );

  const topoMap = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    {
      attribution:
        'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxZoom: 17,
    }
  );

  // Initialize Leaflet Map
  const map = L.map("map", {
    zoomControl: false,
    layers: [esriStreets],
  }).setView([-9.19, -75.015], 6);

  // Reposition zoom controls
  L.control.zoom({ position: "bottomleft" }).addTo(map);

  // Layer Switcher
  // OSM requires an HTTP Referer — only works when served via HTTP/HTTPS,
  // not when opening the HTML directly via the file:// protocol.
  const isServedOverHttp =
    window.location.protocol === "http:" ||
    window.location.protocol === "https:";

  const baseLayers = {
    "Esri Calles": esriStreets,
    "Esri Satélite": esriSatellite,
    "OpenTopoMap": topoMap,
    ...(isServedOverHttp ? { "OpenStreetMap": osm } : {}),
  };
  L.control.layers(baseLayers, null, { position: "topright" }).addTo(map);

  // Color ramp palette
  const COLOR_STOPS = [
    { threshold: 25, rgb: [215, 48, 39], hex: "#d73027" },
    { threshold: 20, rgb: [244, 109, 67], hex: "#f46d43" },
    { threshold: 15, rgb: [253, 174, 97], hex: "#fdae61" },
    { threshold: 10, rgb: [254, 224, 139], hex: "#fee08b" },
    { threshold: 5,  rgb: [217, 239, 139], hex: "#d9ef8b" },
    { threshold: 0,  rgb: [145, 191, 219], hex: "#91bfdb" },
    { threshold: -Infinity, rgb: [69, 117, 180], hex: "#4575b4" },
  ];

  function getColorRgb(val) {
    if (val === null || val === undefined || isNaN(val)) {
      return null;
    }
    for (const stop of COLOR_STOPS) {
      if (val > stop.threshold) {
        return stop.rgb;
      }
    }
    return [69, 117, 180];
  }

  function getColorHex(val) {
    if (val === null || val === undefined || isNaN(val)) {
      return "transparent";
    }
    for (const stop of COLOR_STOPS) {
      if (val > stop.threshold) {
        return stop.hex;
      }
    }
    return "#4575b4";
  }

  let rasterOverlay = null;

  // Add Opacity Slider Control to the map
  const OpacityControl = L.Control.extend({
    options: { position: "topright" },
    onAdd: function () {
      const container = L.DomUtil.create("div", "leaflet-opacity-control");
      container.innerHTML = `
        <div class="opacity-header">
          <span>Opacidad ráster</span>
          <span id="opacity-label">70%</span>
        </div>
        <input type="range" id="opacity-slider" class="opacity-slider" min="10" max="100" value="70">
      `;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      const slider = container.querySelector("#opacity-slider");
      const label = container.querySelector("#opacity-label");

      slider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10);
        label.textContent = `${val}%`;
        if (rasterOverlay) {
          rasterOverlay.setOpacity(val / 100);
        }
      });

      return container;
    },
  });
  map.addControl(new OpacityControl());

  // Render raster matrix into canvas using high-performance ImageData
  function createRasterImage(raster) {
    const canvas = document.createElement("canvas");
    canvas.width = raster.width;
    canvas.height = raster.height;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(raster.width, raster.height);
    const buf = imgData.data;

    for (let y = 0; y < raster.height; y++) {
      const row = raster.data[y];
      const rowOffset = y * raster.width;
      for (let x = 0; x < raster.width; x++) {
        const rgb = getColorRgb(row[x]);
        if (rgb) {
          const idx = (rowOffset + x) * 4;
          buf[idx] = rgb[0];
          buf[idx + 1] = rgb[1];
          buf[idx + 2] = rgb[2];
          buf[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL();
  }

  // Setup click interaction with pure geographic projection math
  function setupMapInteraction(raster, bounds) {
    const south = raster.bounds[0][0];
    const west = raster.bounds[0][1];
    const north = raster.bounds[1][0];
    const east = raster.bounds[1][1];

    map.on("click", (e) => {
      if (!bounds.contains(e.latlng)) {
        map.closePopup();
        return;
      }

      // Exact mathematical coordinate projection
      const relX = (e.latlng.lng - west) / (east - west);
      const relY = (north - e.latlng.lat) / (north - south);

      if (relX < 0 || relX >= 1 || relY < 0 || relY >= 1) {
        map.closePopup();
        return;
      }

      const x = Math.floor(relX * raster.width);
      const y = Math.floor(relY * raster.height);

      const safeX = Math.max(0, Math.min(raster.width - 1, x));
      const safeY = Math.max(0, Math.min(raster.height - 1, y));

      const temp = raster.data[safeY][safeX];

      if (temp !== null && temp !== undefined && !isNaN(temp)) {
        L.popup()
          .setLatLng(e.latlng)
          .setContent(`
            <div class="popup-temp">
              <strong>Pronóstico de Temp. Mínima</strong><br>
              <span>${temp} °C</span>
            </div>
          `)
          .openOn(map);
      } else {
        map.closePopup();
      }
    });
  }

  // Fetch raster data with cold-start management and retry logic
  function fetchRasterData(attempt = 1, maxAttempts = 3) {
    loadingText.innerText = `Cargando datos ráster (intento ${attempt} de ${maxAttempts})...`;
    retryBtn.style.display = "none";
    loaderSpinner.style.display = "inline-block";

    // Show cold-start explanation if it takes longer than 4 seconds
    const noticeTimer = setTimeout(() => {
      serverNotice.style.display = "block";
    }, 4000);

    fetch(`${API_BASE_URL}/api/raster-data`)
      .then((res) => {
        clearTimeout(noticeTimer);
        if (!res.ok) {
          throw new Error(`Error HTTP: ${res.status}`);
        }
        return res.json();
      })
      .then((raster) => {
        const bounds = L.latLngBounds(raster.bounds);
        const imageUrl = createRasterImage(raster);

        if (rasterOverlay) {
          map.removeLayer(rasterOverlay);
        }

        rasterOverlay = L.imageOverlay(imageUrl, bounds, {
          opacity: 0.7,
        }).addTo(map);

        map.fitBounds(bounds);
        setupMapInteraction(raster, bounds);

        // Display summary statistics if available from backend
        if (raster.stats && raster.stats.min !== null) {
          statMin.innerText = raster.stats.min;
          statMean.innerText = raster.stats.mean;
          statMax.innerText = raster.stats.max;
          statsBadge.style.display = "inline-flex";
        }

        // Hide loader overlay
        loaderOverlay.style.opacity = "0";
        setTimeout(() => {
          loaderOverlay.style.visibility = "hidden";
        }, 400);
      })
      .catch((err) => {
        clearTimeout(noticeTimer);
        console.warn(`Intento ${attempt} fallido:`, err);

        if (attempt < maxAttempts) {
          loadingText.innerText = `Reintentando en 3 segundos (despertando servidor)...`;
          setTimeout(() => {
            fetchRasterData(attempt + 1, maxAttempts);
          }, 3000);
        } else {
          loaderSpinner.style.display = "none";
          serverNotice.style.display = "block";
          loadingText.innerText = "No se pudo conectar con el servidor.";
          retryBtn.style.display = "inline-block";
        }
      });
  }

  retryBtn.addEventListener("click", () => {
    fetchRasterData(1, 3);
  });

  // Start initial fetch
  fetchRasterData();

  // Add Legend Control
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");
    const grades = [0, 5, 10, 15, 20, 25];
    div.innerHTML = "<strong class='legend-title'>Temperatura (°C)</strong><br>";

    // Cold grade (< 0)
    div.innerHTML += '<i style="background:' + getColorHex(-1) + '"></i> &le; 0<br>';

    for (let i = 0; i < grades.length; i++) {
      div.innerHTML +=
        '<i style="background:' +
        getColorHex(grades[i] + 0.1) +
        '"></i> ' +
        grades[i] +
        (grades[i + 1] !== undefined ? "&ndash;" + grades[i + 1] + "<br>" : "+");
    }
    return div;
  };
  legend.addTo(map);
});
