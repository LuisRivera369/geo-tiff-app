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

  const panelToggle = document.getElementById("panel-toggle");
  const panelToggleLabel = document.getElementById("panel-toggle-label");
  const panelControls = document.getElementById("panel-controls");
  const themeOptions = document.querySelectorAll(".theme-option");
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const legendList = document.getElementById("legend-list");
  const legendStrip = document.getElementById("legend-strip");
  const legendTicks = document.getElementById("legend-ticks");

  // Dynamic API detection: local backend during local development, Render in production
  const API_BASE_URL =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
      ? "http://localhost:5000"
      : "https://luisrivera.pythonanywhere.com"
      /* : "https://app-geo-json-luis.onrender.com"; */;

  /* ==========================================================
     1. Viewport
     En móvil, 100vh incluye la barra del navegador. Se usa
     100dvh (altura dinámica) y, en navegadores sin soporte,
     se calcula con visualViewport.
     ========================================================== */
  const supportsDvh =
    window.CSS && CSS.supports && CSS.supports("height", "100dvh");

  function syncViewportHeight() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--app-vh", `${h}px`);
  }

  if (!supportsDvh) {
    syncViewportHeight();
    window.addEventListener("resize", syncViewportHeight);
    window.addEventListener("orientationchange", syncViewportHeight);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncViewportHeight);
    }
  }

  /* ==========================================================
     2. Base layers
     ========================================================== */
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

  // Initialize Leaflet Map
  const map = L.map("map", {
    zoomControl: false,
    layers: [esriStreets],
  }).setView([-9.19, -75.015], 6);

  // Reposition zoom controls
  L.control.zoom({ position: "bottomleft" }).addTo(map);

  /* ==========================================================
     3. Paleta de colores
     ========================================================== */
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

  /* ==========================================================
     4. Leyenda (fuera de Leaflet para controlar su posición)
     ========================================================== */
  const LEGEND_CLASSES = [
    { label: "≤ 0", value: -1 },
    { label: "0 – 5", value: 0.1 },
    { label: "5 – 10", value: 5.1 },
    { label: "10 – 15", value: 10.1 },
    { label: "15 – 20", value: 15.1 },
    { label: "20 – 25", value: 20.1 },
    { label: "25 +", value: 25.1 },
  ];

  function buildLegend() {
    // Variante vertical (desktop)
    legendList.innerHTML = LEGEND_CLASSES.map(
      (c) =>
        `<span class="legend-row"><i style="background:${getColorHex(
          c.value
        )}"></i>${c.label}</span>`
    ).join("");

    // Variante rampa (mobile): franjas proporcionales + cortes
    legendStrip.innerHTML = LEGEND_CLASSES.map(
      (c) => `<span class="legend-seg" style="background:${getColorHex(c.value)}"></span>`
    ).join("");

    legendTicks.innerHTML = ["", "0", "5", "10", "15", "20", "25+"]
      .map((t) => `<span>${t}</span>`)
      .join("");
  }

  /* ==========================================================
     5. Tema claro / oscuro
     El tema se aplicó en <head> para evitar el flash; aquí sólo
     se sincroniza la UI y se persiste la elección.
     ========================================================== */
  const THEME_KEY = "geo-theme";
  const THEME_COLOR = { light: "#eaeff5", dark: "#0e1723" };

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeOptions.forEach((btn) => {
      btn.setAttribute(
        "aria-pressed",
        String(btn.dataset.themeValue === theme)
      );
    });
    if (themeMeta) {
      themeMeta.setAttribute("content", THEME_COLOR[theme] || THEME_COLOR.light);
    }
  }

  themeOptions.forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.themeValue;
      applyTheme(theme);
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch (e) {
        /* modo privado: el tema no se persiste */
      }
    });
  });

  applyTheme(document.documentElement.getAttribute("data-theme") || "light");

  /* ==========================================================
     6. Control de opacidad (vive dentro del panel desplegable:
        oculto por defecto en mobile, siempre visible en desktop)
     ========================================================== */
  const opacityPanel = document.createElement("div");
  opacityPanel.className = "opacity-panel";
  opacityPanel.innerHTML = `
    <div class="opacity-header">
      <span class="opacity-title">Opacidad ráster</span>
      <span class="opacity-value" id="opacity-label">70%</span>
    </div>
    <input type="range" id="opacity-slider" class="opacity-slider" min="10" max="100" value="70" aria-label="Opacidad del ráster">
  `;

  panelControls.appendChild(opacityPanel);

  const opacitySlider = opacityPanel.querySelector("#opacity-slider");
  const opacityLabel = opacityPanel.querySelector("#opacity-label");

  opacitySlider.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    opacityLabel.textContent = `${val}%`;
    if (rasterOverlay) {
      rasterOverlay.setOpacity(val / 100);
    }
  });

  /* ==========================================================
     7. Layout adaptativo (mobile ↔ desktop)
     ========================================================== */
  const mqMobile = window.matchMedia("(max-width: 767px)");

  let layersControl = null;

  function syncLayersControl() {
    const mobile = mqMobile.matches;
    if (layersControl) {
      map.removeControl(layersControl);
      layersControl = null;
    }
    layersControl = L.control.layers(baseLayers, null, {
      // Mobile: colapsado a un botón, arriba a la derecha.
      // Desktop: expandido, arriba a la izquierda.
      position: mobile ? "topright" : "topleft",
      collapsed: mobile,
    }).addTo(map);
  }

  function syncLayout() {
    syncLayersControl();
    setPanelOpen(!mqMobile.matches);
    map.invalidateSize({ pan: false });
  }

  /* ==========================================================
     8. Panel desplegable
     ========================================================== */
  function setPanelOpen(open) {
    document.body.classList.toggle("panel-open", open);
    panelToggle.setAttribute("aria-expanded", String(open));
    panelToggleLabel.textContent = open
      ? "Ocultar información y controles"
      : "Mostrar información y controles";
  }

  panelToggle.addEventListener("click", () => {
    setPanelOpen(!document.body.classList.contains("panel-open"));
  });

  if (mqMobile.addEventListener) {
    mqMobile.addEventListener("change", syncLayout);
  } else if (mqMobile.addListener) {
    mqMobile.addListener(syncLayout);
  }

  /* ==========================================================
     9. Raster: render + interacción
     ========================================================== */
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

    const onMapClick = (e) => {
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
              <strong>Pronóstico de Temp. Mínima</strong>
              <span>${temp} °C</span>
            </div>
          `)
          .openOn(map);
      } else {
        map.closePopup();
      }
    };

    // Evita handlers duplicados cuando se reintenta la carga
    map.off("click", onMapClick);
    map.on("click", onMapClick);
  }

  /* ==========================================================
     10. Fetch con cold-start y reintentos
     ========================================================== */
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
          opacity: parseInt(opacitySlider.value, 10) / 100,
        }).addTo(map);

        map.fitBounds(bounds);
        setupMapInteraction(raster, bounds);

        // Display summary statistics if available from backend
        if (raster.stats && raster.stats.min !== null) {
          statMin.innerText = raster.stats.min;
          statMean.innerText = raster.stats.mean;
          statMax.innerText = raster.stats.max;
          statsBadge.hidden = false;
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

  /* ==========================================================
     11. Bootstrap
     ========================================================== */
  buildLegend();
  syncLayout();

  // Start initial fetch
  fetchRasterData();

  // Leaflet no recalcula el tamaño cuando la barra del navegador móvil
  // se pliega/despliega: hay que forzarlo.
  let resizeRaf = null;
  function onViewportChange() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  }

  window.addEventListener("resize", onViewportChange);
  window.addEventListener("orientationchange", onViewportChange);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onViewportChange);
  }
});
