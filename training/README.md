## Model training (TensorFlow)

This folder contains a simple training pipeline to learn the four landmark
points: index base, index tip, ring base, and ring tip.

### 1) Collect annotations

Use `labeler.html` in the browser:

1. Upload a batch of hand photos.
2. Click **Start labeling** and mark the four points.
3. Click **Save annotation** for each image.
4. Click **Download JSON**.

Save the JSON as `training/annotations.json` and copy the images into
`training/images/` with the same filenames as in the JSON.

### 2) Install dependencies

```bash
pip install -r training/requirements.txt
```

### 3) Train the model

```bash
python training/train.py \
  --data training/annotations.json \
  --images-dir training/images \
  --output-dir training/output \
  --input-size 256 \
  --epochs 50
```

This produces a TensorFlow SavedModel in `training/output/saved_model`.

### 4) Convert to TensorFlow.js

```bash
tensorflowjs_converter \
  --input_format=tf_saved_model \
  --output_format=tfjs_graph_model \
  training/output/saved_model \
  training/output/tfjs_model
```

Copy the TFJS artifacts into `models/handscan/`:

```
models/handscan/model.json
models/handscan/*.bin
```

### 5) Update the web app config

Confirm `MODEL_SETTINGS` in `custom_model_stub.js` matches your training
settings:

- `inputSize` should equal `--input-size`.
- `letterbox` should match the training pipeline.
- `output.order` should remain:
  `indexBase`, `indexTip`, `ringBase`, `ringTip`.

### Annotation format

```json
{
  "version": 1,
  "order": ["indexBase", "indexTip", "ringBase", "ringTip"],
  "items": [
    {
      "image": "example.jpg",
      "width": 4032,
      "height": 3024,
      "landmarks": {
        "indexBase": [123.4, 456.7],
        "indexTip": [345.6, 210.1],
        "ringBase": [512.3, 448.8],
        "ringTip": [698.2, 194.4]
      }
    }
  ]
}
```
