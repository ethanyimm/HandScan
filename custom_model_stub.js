"use strict";

// TensorFlow.js landmark integration.
// Update MODEL_SETTINGS to match your model's input/output specs.
const MODEL_SETTINGS = {
  modelUrl: "",
  modelType: "graph", // "graph" or "layers"
  inputSize: { width: 256, height: 256 },
  letterbox: true,
  input: {
    color: "rgb", // "rgb" or "bgr"
    scale: 1 / 255,
    mean: [0, 0, 0],
    std: [1, 1, 1],
  },
  output: {
    normalized: true, // true if coords are 0..1 relative to input size
    order: ["indexBase", "indexTip", "ringBase", "ringTip"],
    stride: 2, // values per point (x,y) or (x,y,score)
    xyOrder: "xy", // "xy" or "yx"
    offset: 0,
    tensorName: null, // set if model returns named tensors
    confidenceIndex: null, // optional index into flat output array
  },
  defaultConfidence: 0.65,
};

let modelPromise = null;

window.detectFingerLandmarks = async (canvas) => {
  ensureTensorFlow();
  validateSettings();

  const model = await getModel();
  const { inputTensor, transform } = createInputTensor(canvas, MODEL_SETTINGS);

  let outputs;
  let outputTensor;
  try {
    outputs = await runModel(model, inputTensor);
    outputTensor = pickOutputTensor(outputs, MODEL_SETTINGS.output.tensorName);

    const data = await outputTensor.data();
    const landmarks = mapOutputToLandmarks(
      data,
      transform,
      MODEL_SETTINGS
    );

    return {
      ...landmarks.points,
      confidence: landmarks.confidence,
    };
  } finally {
    inputTensor.dispose();
    disposeOutputs(outputs);
  }
};

function ensureTensorFlow() {
  if (typeof window.tf === "undefined") {
    throw new Error("TensorFlow.js is not loaded.");
  }
}

function validateSettings() {
  const { modelUrl, inputSize, output } = MODEL_SETTINGS;
  if (!modelUrl) {
    const error = new Error("MODEL_URL_NOT_SET");
    error.code = "MODEL_URL_NOT_SET";
    throw error;
  }
  if (!inputSize || !inputSize.width || !inputSize.height) {
    throw new Error("MODEL_SETTINGS.inputSize must define width/height.");
  }
  if (!output || !Array.isArray(output.order) || output.order.length === 0) {
    throw new Error("MODEL_SETTINGS.output.order must list keypoints.");
  }
}

function getModel() {
  if (!modelPromise) {
    modelPromise = loadModel();
  }
  return modelPromise;
}

async function loadModel() {
  if (MODEL_SETTINGS.modelType === "layers") {
    return window.tf.loadLayersModel(MODEL_SETTINGS.modelUrl);
  }
  return window.tf.loadGraphModel(MODEL_SETTINGS.modelUrl);
}

function runModel(model, inputTensor) {
  if (typeof model.executeAsync === "function") {
    return model.executeAsync(inputTensor);
  }
  if (typeof model.predict === "function") {
    return model.predict(inputTensor);
  }
  throw new Error("Model does not support executeAsync or predict.");
}

function pickOutputTensor(outputs, tensorName) {
  if (!outputs) {
    throw new Error("Model returned no outputs.");
  }
  if (tensorName) {
    if (outputs[tensorName]) {
      return outputs[tensorName];
    }
  }
  if (outputs instanceof window.tf.Tensor) {
    return outputs;
  }
  if (Array.isArray(outputs)) {
    return outputs[0];
  }
  if (typeof outputs === "object") {
    const keys = Object.keys(outputs);
    if (keys.length === 0) {
      throw new Error("Model returned an empty output object.");
    }
    return outputs[keys[0]];
  }
  throw new Error("Unsupported model output type.");
}

function disposeOutputs(outputs) {
  if (!outputs) {
    return;
  }
  if (outputs instanceof window.tf.Tensor) {
    outputs.dispose();
    return;
  }
  if (Array.isArray(outputs)) {
    outputs.forEach((tensor) => tensor.dispose());
    return;
  }
  if (typeof outputs === "object") {
    Object.values(outputs).forEach((tensor) => tensor.dispose());
  }
}

function createInputTensor(canvas, settings) {
  const inputWidth = settings.inputSize.width;
  const inputHeight = settings.inputSize.height;
  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;

  const offscreen = document.createElement("canvas");
  offscreen.width = inputWidth;
  offscreen.height = inputHeight;
  const ctx = offscreen.getContext("2d");

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, inputWidth, inputHeight);

  let scale = inputWidth / sourceWidth;
  let offsetX = 0;
  let offsetY = 0;

  if (settings.letterbox) {
    scale = Math.min(
      inputWidth / sourceWidth,
      inputHeight / sourceHeight
    );
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    offsetX = (inputWidth - drawWidth) / 2;
    offsetY = (inputHeight - drawHeight) / 2;
    ctx.drawImage(
      canvas,
      0,
      0,
      sourceWidth,
      sourceHeight,
      offsetX,
      offsetY,
      drawWidth,
      drawHeight
    );
  } else {
    ctx.drawImage(
      canvas,
      0,
      0,
      sourceWidth,
      sourceHeight,
      0,
      0,
      inputWidth,
      inputHeight
    );
  }

  const inputTensor = window.tf.tidy(() => {
    let tensor = window.tf.browser.fromPixels(offscreen);
    if (settings.input.color === "bgr") {
      tensor = window.tf.reverse(tensor, [2]);
    }
    tensor = tensor.toFloat();

    const scaleValue = settings.input.scale ?? 1;
    if (scaleValue !== 1) {
      tensor = tensor.mul(scaleValue);
    }
    const mean = settings.input.mean ?? [0, 0, 0];
    if (mean.some((value) => value !== 0)) {
      tensor = tensor.sub(window.tf.tensor1d(mean));
    }
    const std = settings.input.std ?? [1, 1, 1];
    if (std.some((value) => value !== 1)) {
      tensor = tensor.div(window.tf.tensor1d(std));
    }

    return tensor.expandDims(0);
  });

  return {
    inputTensor,
    transform: {
      inputWidth,
      inputHeight,
      sourceWidth,
      sourceHeight,
      offsetX,
      offsetY,
      scale,
      letterbox: settings.letterbox,
    },
  };
}

function mapOutputToLandmarks(data, transform, settings) {
  const { order, stride, xyOrder, offset, normalized, confidenceIndex } =
    settings.output;

  const expected = offset + order.length * stride;
  if (data.length < expected) {
    throw new Error(
      `Model output too small. Expected at least ${expected} values.`
    );
  }

  const points = {};
  const xIndex = xyOrder === "yx" ? 1 : 0;
  const yIndex = xyOrder === "yx" ? 0 : 1;

  for (let i = 0; i < order.length; i += 1) {
    const baseIndex = offset + i * stride;
    const rawX = data[baseIndex + xIndex];
    const rawY = data[baseIndex + yIndex];
    const { x, y } = mapPoint(
      rawX,
      rawY,
      normalized,
      transform
    );
    points[order[i]] = { x, y };
  }

  let confidence = settings.defaultConfidence;
  if (confidenceIndex !== null && confidenceIndex !== undefined) {
    confidence = clamp(data[confidenceIndex], 0, 1);
  }

  return { points, confidence };
}

function mapPoint(rawX, rawY, normalized, transform) {
  let x = normalized ? rawX * transform.inputWidth : rawX;
  let y = normalized ? rawY * transform.inputHeight : rawY;

  if (transform.letterbox) {
    x = (x - transform.offsetX) / transform.scale;
    y = (y - transform.offsetY) / transform.scale;
  } else {
    x = (x / transform.inputWidth) * transform.sourceWidth;
    y = (y / transform.inputHeight) * transform.sourceHeight;
  }

  return {
    x: clamp(x, 0, transform.sourceWidth),
    y: clamp(y, 0, transform.sourceHeight),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
