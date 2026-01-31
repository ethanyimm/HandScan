"use strict";

const COIN_TYPES = {
  quarter: { label: "US Quarter (24.26 mm)", diameterMm: 24.26 },
  nickel: { label: "US Nickel (21.21 mm)", diameterMm: 21.21 },
  dime: { label: "US Dime (17.91 mm)", diameterMm: 17.91 },
  penny: { label: "US Penny (19.05 mm)", diameterMm: 19.05 },
  custom: { label: "Custom", diameterMm: 24.26 },
};

const LANDMARK_ORDER = [
  { key: "indexBase", label: "Index base (Jupiter crease)" },
  { key: "indexTip", label: "Index tip" },
  { key: "ringBase", label: "Ring base (Apollo crease)" },
  { key: "ringTip", label: "Ring tip" },
];

const MAX_CANVAS_DIMENSION = 1200;

const state = {
  image: null,
  canvas: null,
  ctx: null,
  cvReady: false,
  mode: null,
  manualQueue: [],
  manualCoinStep: null,
  proxyOffset: 0.15,
  autoRunProxy: true,
  refineCrease: true,
  coin: {
    center: null,
    radiusPx: null,
    confidence: 0,
    source: null,
    diameterCm: COIN_TYPES.quarter.diameterMm / 10,
  },
  landmarks: {
    indexBase: null,
    indexTip: null,
    ringBase: null,
    ringTip: null,
    confidence: 0,
    source: null,
  },
};

const elements = {};
let mediapipeHands = null;
let mediapipeResolver = null;

document.addEventListener("DOMContentLoaded", () => {
  elements.imageInput = document.getElementById("imageInput");
  elements.coinType = document.getElementById("coinType");
  elements.coinDiameter = document.getElementById("coinDiameter");
  elements.detectCoinBtn = document.getElementById("detectCoinBtn");
  elements.manualCoinBtn = document.getElementById("manualCoinBtn");
  elements.autoLandmarksBtn = document.getElementById("autoLandmarksBtn");
  elements.proxyLandmarksBtn = document.getElementById("proxyLandmarksBtn");
  elements.manualLandmarksBtn = document.getElementById("manualLandmarksBtn");
  elements.clearLandmarksBtn = document.getElementById("clearLandmarksBtn");
  elements.creaseOffset = document.getElementById("creaseOffset");
  elements.autoRunProxy = document.getElementById("autoRunProxy");
  elements.refineCrease = document.getElementById("refineCrease");
  elements.length2d = document.getElementById("length2d");
  elements.length4d = document.getElementById("length4d");
  elements.ratio = document.getElementById("ratio");
  elements.confidence = document.getElementById("confidence");
  elements.status = document.getElementById("status");
  elements.canvasHint = document.getElementById("canvasHint");
  elements.canvas = document.getElementById("imageCanvas");

  state.canvas = elements.canvas;
  state.ctx = elements.canvas.getContext("2d");

  initCoinControls();
  initProxyControls();
  bindEvents();
  attachOpenCv();
  updateOutputs();
});

function initCoinControls() {
  elements.coinType.value = "quarter";
  updateCoinDiameterForType();
}

function initProxyControls() {
  elements.creaseOffset.value = "15";
  elements.autoRunProxy.checked = true;
  elements.refineCrease.checked = true;
  state.autoRunProxy = true;
  state.refineCrease = true;
  updateProxyOffset();
}

function bindEvents() {
  elements.imageInput.addEventListener("change", handleImageUpload);
  elements.coinType.addEventListener("change", updateCoinDiameterForType);
  elements.coinDiameter.addEventListener("input", handleCoinDiameterInput);
  elements.detectCoinBtn.addEventListener("click", detectCoin);
  elements.manualCoinBtn.addEventListener("click", startManualCoin);
  elements.autoLandmarksBtn.addEventListener("click", autoDetectLandmarks);
  elements.proxyLandmarksBtn.addEventListener("click", runProxyLandmarks);
  elements.manualLandmarksBtn.addEventListener("click", startManualLandmarks);
  elements.clearLandmarksBtn.addEventListener("click", clearLandmarks);
  elements.creaseOffset.addEventListener("input", updateProxyOffset);
  elements.autoRunProxy.addEventListener("change", updateAutoRunProxy);
  elements.refineCrease.addEventListener("change", updateRefineCrease);
  elements.canvas.addEventListener("click", handleCanvasClick);
}

function attachOpenCv() {
  if (typeof cv === "undefined") {
    setStatus("OpenCV failed to load. Coin detection unavailable.");
    return;
  }
  cv.onRuntimeInitialized = () => {
    state.cvReady = true;
    setStatus("OpenCV ready. Upload a photo.");
  };
}

function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    const image = new Image();
    image.onload = () => {
      state.image = image;
      resetStateForImage();
      drawImageToCanvas(image);
      setStatus("Image loaded. Detect the coin or mark it manually.");
      elements.canvasHint.style.display = "none";
      if (state.autoRunProxy) {
        runProxyLandmarks();
      }
    };
    image.src = loadEvent.target.result;
  };
  reader.readAsDataURL(file);
}

function resetStateForImage() {
  state.coin.center = null;
  state.coin.radiusPx = null;
  state.coin.confidence = 0;
  state.coin.source = null;
  state.landmarks.indexBase = null;
  state.landmarks.indexTip = null;
  state.landmarks.ringBase = null;
  state.landmarks.ringTip = null;
  state.landmarks.confidence = 0;
  state.landmarks.source = null;
  state.mode = null;
  state.manualQueue = [];
  state.manualCoinStep = null;
  updateOutputs();
}

function drawImageToCanvas(image) {
  const scale = Math.min(
    1,
    MAX_CANVAS_DIMENSION / Math.max(image.width, image.height)
  );
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  elements.canvas.width = width;
  elements.canvas.height = height;
  state.ctx.clearRect(0, 0, width, height);
  state.ctx.drawImage(image, 0, 0, width, height);
  renderOverlay();
}

function updateCoinDiameterForType() {
  const type = elements.coinType.value;
  const typeData = COIN_TYPES[type];
  elements.coinDiameter.value = typeData.diameterMm.toFixed(2);
  elements.coinDiameter.disabled = type !== "custom";
  handleCoinDiameterInput();
}

function handleCoinDiameterInput() {
  const mmValue = Number.parseFloat(elements.coinDiameter.value);
  if (!Number.isFinite(mmValue) || mmValue <= 0) {
    setStatus("Coin diameter must be a positive number.");
    return;
  }
  state.coin.diameterCm = mmValue / 10;
  updateOutputs();
}

function updateProxyOffset() {
  const rawValue = Number.parseFloat(elements.creaseOffset.value);
  if (!Number.isFinite(rawValue)) {
    state.proxyOffset = 0.15;
    return;
  }
  state.proxyOffset = clamp(rawValue / 100, 0, 0.3);
}

function updateAutoRunProxy() {
  state.autoRunProxy = Boolean(elements.autoRunProxy.checked);
}

function updateRefineCrease() {
  state.refineCrease = Boolean(elements.refineCrease.checked);
}

function startManualCoin() {
  if (!state.image) {
    setStatus("Upload an image first.");
    return;
  }
  state.mode = "manualCoin";
  state.manualCoinStep = "center";
  state.coin.center = null;
  state.coin.radiusPx = null;
  state.coin.source = "manual";
  state.coin.confidence = 0;
  setStatus("Manual coin: click the coin center.");
}

function startManualLandmarks() {
  if (!state.image) {
    setStatus("Upload an image first.");
    return;
  }
  state.mode = "manualLandmarks";
  state.manualQueue = LANDMARK_ORDER.map((item) => item.key);
  setStatus(`Manual landmarks: click ${labelForKey(state.manualQueue[0])}.`);
}

function clearLandmarks() {
  state.landmarks.indexBase = null;
  state.landmarks.indexTip = null;
  state.landmarks.ringBase = null;
  state.landmarks.ringTip = null;
  state.landmarks.confidence = 0;
  state.landmarks.source = null;
  state.mode = null;
  state.manualQueue = [];
  setStatus("Landmarks cleared.");
  renderOverlay();
  updateOutputs();
}

function handleCanvasClick(event) {
  if (!state.image) {
    return;
  }
  const point = getCanvasPoint(event);
  if (state.mode === "manualCoin") {
    handleManualCoinClick(point);
    return;
  }
  if (state.mode === "manualLandmarks") {
    handleManualLandmarkClick(point);
  }
}

function handleManualCoinClick(point) {
  if (state.manualCoinStep === "center") {
    state.coin.center = point;
    state.manualCoinStep = "edge";
    setStatus("Manual coin: click a point on the coin edge.");
  } else {
    const radiusPx = distance(state.coin.center, point);
    if (radiusPx < 5) {
      setStatus("Coin radius too small. Try again.");
      return;
    }
    state.coin.radiusPx = radiusPx;
    state.coin.confidence = 0.9;
    state.mode = null;
    state.manualCoinStep = null;
    setStatus("Manual coin set.");
  }
  renderOverlay();
  updateOutputs();
}

function handleManualLandmarkClick(point) {
  const nextKey = state.manualQueue.shift();
  if (!nextKey) {
    state.mode = null;
    return;
  }
  state.landmarks[nextKey] = point;
  if (state.manualQueue.length === 0) {
    state.mode = null;
    state.landmarks.source = "manual";
    state.landmarks.confidence = 0.9;
    setStatus("Landmarks set.");
  } else {
    setStatus(`Manual landmarks: click ${labelForKey(state.manualQueue[0])}.`);
  }
  renderOverlay();
  updateOutputs();
}

async function autoDetectLandmarks() {
  if (!state.image) {
    setStatus("Upload an image first.");
    return;
  }
  if (typeof window.detectFingerLandmarks !== "function") {
    setStatus("Custom model not loaded. Using proxy landmarks instead.");
    await runProxyLandmarks();
    return;
  }
  setStatus("Running custom landmark model...");
  try {
    const result = await window.detectFingerLandmarks(elements.canvas);
    if (!result) {
      setStatus("Custom model returned no landmarks. Using proxy landmarks.");
      await runProxyLandmarks();
      return;
    }
    const nextLandmarks = {
      indexBase: result.indexBase,
      indexTip: result.indexTip,
      ringBase: result.ringBase,
      ringTip: result.ringTip,
    };
    if (!areLandmarksValid(nextLandmarks)) {
      setStatus("Custom model landmarks invalid. Using proxy landmarks.");
      await runProxyLandmarks();
      return;
    }
    state.landmarks = {
      ...nextLandmarks,
      confidence: clamp(result.confidence ?? 0.6, 0, 1),
      source: "auto",
    };
    setStatus("Landmarks detected.");
  } catch (error) {
    console.error(error);
    setStatus("Custom model failed. Using proxy landmarks.");
    await runProxyLandmarks();
  }
  renderOverlay();
  updateOutputs();
}

async function runProxyLandmarks() {
  if (!state.image) {
    setStatus("Upload an image first.");
    return;
  }
  if (typeof window.Hands === "undefined") {
    setStatus("MediaPipe Hands is unavailable.");
    return;
  }

  elements.proxyLandmarksBtn.disabled = true;
  setStatus("Running proxy landmarks (MediaPipe joints)...");

  try {
    const results = await runMediapipeHands(elements.canvas);
    if (
      !results ||
      !results.multiHandLandmarks ||
      results.multiHandLandmarks.length === 0
    ) {
      setStatus("No hand detected. Try a clearer photo.");
      return;
    }
    const imageData = state.ctx.getImageData(
      0,
      0,
      elements.canvas.width,
      elements.canvas.height
    );
    const points = proxyLandmarksFromMediapipe(results, imageData);
    if (!points || !areLandmarksValid(points)) {
      setStatus("Proxy landmarks incomplete.");
      return;
    }

    const confidence = clamp(
      results.multiHandedness?.[0]?.score ?? 0.6,
      0,
      1
    );
    state.landmarks = {
      ...points,
      confidence: confidence * 0.5,
      source: "proxy",
    };
    setStatus("Proxy landmarks set (approximate).");
  } catch (error) {
    console.error(error);
    setStatus("Proxy landmark inference failed.");
  } finally {
    elements.proxyLandmarksBtn.disabled = false;
  }

  renderOverlay();
  updateOutputs();
}

function detectCoin() {
  if (!state.image) {
    setStatus("Upload an image first.");
    return;
  }
  if (!state.cvReady) {
    setStatus("OpenCV is still loading.");
    return;
  }

  const src = cv.imread(elements.canvas);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const circles = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
  cv.medianBlur(gray, gray, 5);
  cv.Canny(gray, edges, 80, 160);

  const minDim = Math.min(gray.rows, gray.cols);
  const minDist = Math.round(minDim * 0.25);
  const minRadius = Math.round(minDim * 0.03);
  const maxRadius = Math.round(minDim * 0.25);

  cv.HoughCircles(
    gray,
    circles,
    cv.HOUGH_GRADIENT,
    1,
    minDist,
    120,
    30,
    minRadius,
    maxRadius
  );

  let bestCircle = null;
  if (circles.cols > 0) {
    for (let i = 0; i < circles.cols; i += 1) {
      const x = circles.data32F[i * 3];
      const y = circles.data32F[i * 3 + 1];
      const r = circles.data32F[i * 3 + 2];
      const coverage = circleEdgeCoverage(edges, x, y, r);
      if (coverage < 0.35) {
        continue;
      }
      const normalizedRadius = r / maxRadius;
      const score = coverage * 0.7 + normalizedRadius * 0.3;
      if (!bestCircle || score > bestCircle.score) {
        bestCircle = { x, y, r, coverage, score };
      }
    }
  }

  src.delete();
  gray.delete();
  edges.delete();
  circles.delete();

  if (!bestCircle) {
    setStatus("Coin not found. Try manual coin selection.");
    return;
  }

  state.coin.center = { x: bestCircle.x, y: bestCircle.y };
  state.coin.radiusPx = bestCircle.r;
  state.coin.confidence = clamp(bestCircle.coverage, 0, 1);
  state.coin.source = "auto";

  if (state.coin.confidence < 0.55) {
    setStatus("Coin detected with low confidence. Consider manual coin.");
  } else {
    setStatus("Coin detected.");
  }
  renderOverlay();
  updateOutputs();
}

function loadMediapipeHands() {
  if (!mediapipeHands) {
    mediapipeHands = new window.Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    mediapipeHands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    mediapipeHands.onResults((results) => {
      if (mediapipeResolver) {
        const resolve = mediapipeResolver;
        mediapipeResolver = null;
        resolve(results);
      }
    });
  }
  return mediapipeHands;
}

function runMediapipeHands(canvas) {
  return new Promise((resolve, reject) => {
    if (mediapipeResolver) {
      reject(new Error("MediaPipe inference already running."));
      return;
    }
    const hands = loadMediapipeHands();
    mediapipeResolver = resolve;
    hands
      .send({ image: canvas })
      .catch((error) => {
        mediapipeResolver = null;
        reject(error);
      });
  });
}

function proxyLandmarksFromMediapipe(results, imageData) {
  const landmarks = results.multiHandLandmarks?.[0];
  if (!landmarks || landmarks.length < 21) {
    return null;
  }
  const width = elements.canvas.width;
  const height = elements.canvas.height;

  const wrist = toPoint(landmarks[0], width, height);
  const indexMcp = toPoint(landmarks[5], width, height);
  const indexTip = toPoint(landmarks[8], width, height);
  const ringMcp = toPoint(landmarks[13], width, height);
  const ringTip = toPoint(landmarks[16], width, height);

  if (!wrist || !indexMcp || !indexTip || !ringMcp || !ringTip) {
    return null;
  }

  const offset = clamp(state.proxyOffset ?? 0.15, 0, 0.3);
  let indexBase = interpolate(indexMcp, wrist, offset);
  let ringBase = interpolate(ringMcp, wrist, offset);

  if (state.refineCrease && imageData) {
    indexBase = refineCreasePoint(
      indexBase,
      indexMcp,
      indexTip,
      wrist,
      imageData
    );
    ringBase = refineCreasePoint(
      ringBase,
      ringMcp,
      ringTip,
      wrist,
      imageData
    );
  }

  return {
    indexBase,
    indexTip,
    ringBase,
    ringTip,
  };
}

function toPoint(landmark, width, height) {
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }
  return {
    x: landmark.x * width,
    y: landmark.y * height,
  };
}

function refineCreasePoint(base, mcp, tip, wrist, imageData) {
  const fingerDir = normalizeVector(subtract(tip, mcp));
  const palmDir = normalizeVector(subtract(wrist, mcp));
  if (!fingerDir || !palmDir) {
    return base;
  }

  const lineLength = Math.hypot(wrist.x - mcp.x, wrist.y - mcp.y);
  if (lineLength < 1) {
    return base;
  }

  const t0 = Math.min(
    0.35,
    Math.max(0.02, distance(mcp, base) / lineLength)
  );
  const searchRange = 0.08;
  const step = 0.01;
  let bestPoint = base;
  let bestScore = -Infinity;

  for (
    let t = Math.max(0.02, t0 - searchRange);
    t <= Math.min(0.35, t0 + searchRange);
    t += step
  ) {
    const candidate = {
      x: mcp.x + palmDir.x * lineLength * t,
      y: mcp.y + palmDir.y * lineLength * t,
    };
    const score = creaseEdgeScore(candidate, fingerDir, imageData, lineLength);
    if (score > bestScore) {
      bestScore = score;
      bestPoint = candidate;
    }
  }

  return bestPoint;
}

function creaseEdgeScore(point, fingerDir, imageData, lineLength) {
  const perp = { x: -fingerDir.y, y: fingerDir.x };
  const base = clamp(lineLength * 0.04, 4, 18);
  const offsets = [base, base * 1.6, base * 2.2];
  let score = 0;

  offsets.forEach((offset) => {
    const a = sampleGray(
      imageData,
      point.x + perp.x * offset,
      point.y + perp.y * offset
    );
    const b = sampleGray(
      imageData,
      point.x - perp.x * offset,
      point.y - perp.y * offset
    );
    score += Math.abs(a - b);
  });

  return score;
}

function sampleGray(imageData, x, y) {
  const width = imageData.width;
  const height = imageData.height;
  const xi = Math.round(clamp(x, 0, width - 1));
  const yi = Math.round(clamp(y, 0, height - 1));
  const index = (yi * width + xi) * 4;
  const data = imageData.data;
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function normalizeVector(vector) {
  if (!vector) {
    return null;
  }
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-6) {
    return null;
  }
  return { x: vector.x / length, y: vector.y / length };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function interpolate(from, to, t) {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

function circleEdgeCoverage(edgeMat, x, y, r) {
  const samples = 48;
  let hits = 0;
  for (let i = 0; i < samples; i += 1) {
    const theta = (Math.PI * 2 * i) / samples;
    const px = Math.round(x + r * Math.cos(theta));
    const py = Math.round(y + r * Math.sin(theta));
    if (px < 0 || py < 0 || px >= edgeMat.cols || py >= edgeMat.rows) {
      continue;
    }
    if (edgeMat.ucharPtr(py, px)[0] > 0) {
      hits += 1;
    }
  }
  return hits / samples;
}

function renderOverlay() {
  if (!state.image) {
    return;
  }
  state.ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  state.ctx.drawImage(
    state.image,
    0,
    0,
    elements.canvas.width,
    elements.canvas.height
  );

  if (state.coin.center && state.coin.radiusPx) {
    drawCircle(state.coin.center, state.coin.radiusPx, "#1c9bff");
    drawPoint(state.coin.center, "#1c9bff", "Coin");
  }

  drawLandmark(state.landmarks.indexBase, "#2ecc71", "2D base");
  drawLandmark(state.landmarks.indexTip, "#27ae60", "2D tip");
  drawLandmark(state.landmarks.ringBase, "#9b59b6", "4D base");
  drawLandmark(state.landmarks.ringTip, "#8e44ad", "4D tip");
}

function drawCircle(center, radius, color) {
  state.ctx.beginPath();
  state.ctx.strokeStyle = color;
  state.ctx.lineWidth = 2;
  state.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  state.ctx.stroke();
}

function drawLandmark(point, color, label) {
  if (!point) {
    return;
  }
  drawPoint(point, color, label);
}

function drawPoint(point, color, label) {
  state.ctx.beginPath();
  state.ctx.fillStyle = color;
  state.ctx.strokeStyle = "#ffffff";
  state.ctx.lineWidth = 2;
  state.ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
  state.ctx.fill();
  state.ctx.stroke();

  if (label) {
    state.ctx.font = "12px sans-serif";
    state.ctx.fillStyle = "#1d1f26";
    state.ctx.fillText(label, point.x + 8, point.y - 8);
  }
}

function updateOutputs() {
  const lengths = computeMeasurements();
  if (!lengths) {
    elements.length2d.textContent = "—";
    elements.length4d.textContent = "—";
    elements.ratio.textContent = "—";
    elements.confidence.textContent = "—";
    return;
  }
  elements.length2d.textContent = `${lengths.length2dCm.toFixed(2)} cm`;
  elements.length4d.textContent = `${lengths.length4dCm.toFixed(2)} cm`;
  elements.ratio.textContent = lengths.ratio.toFixed(3);
  elements.confidence.textContent = `${Math.round(
    lengths.confidence * 100
  )}%`;
}

function computeMeasurements() {
  const { indexBase, indexTip, ringBase, ringTip } = state.landmarks;
  const { radiusPx, diameterCm } = state.coin;

  if (!indexBase || !indexTip || !ringBase || !ringTip || !radiusPx) {
    return null;
  }
  const cmPerPx = diameterCm / (2 * radiusPx);
  const length2dCm = distance(indexBase, indexTip) * cmPerPx;
  const length4dCm = distance(ringBase, ringTip) * cmPerPx;
  const ratio = length2dCm / length4dCm;

  const coinConfidence = clamp(state.coin.confidence ?? 0, 0, 1);
  const landmarkConfidence = clamp(state.landmarks.confidence ?? 0, 0, 1);
  const confidence = Math.min(coinConfidence, landmarkConfidence);

  return {
    length2dCm,
    length4dCm,
    ratio,
    confidence,
  };
}

function labelForKey(key) {
  const match = LANDMARK_ORDER.find((item) => item.key === key);
  return match ? match.label : key;
}

function areLandmarksValid(landmarks) {
  return (
    isPoint(landmarks.indexBase) &&
    isPoint(landmarks.indexTip) &&
    isPoint(landmarks.ringBase) &&
    isPoint(landmarks.ringTip)
  );
}

function isPoint(point) {
  return (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.y >= 0
  );
}

function getCanvasPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  const scaleX = elements.canvas.width / rect.width;
  const scaleY = elements.canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setStatus(message) {
  elements.status.textContent = message;
}
