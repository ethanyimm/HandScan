import argparse
import json
import random
from pathlib import Path

import numpy as np
from PIL import Image
import tensorflow as tf


ORDER = ["indexBase", "indexTip", "ringBase", "ringTip"]


def parse_args():
    parser = argparse.ArgumentParser(
        description="Train 2D:4D landmark model."
    )
    parser.add_argument("--data", required=True, help="Path to annotations.json")
    parser.add_argument(
        "--images-dir", required=True, help="Directory with training images"
    )
    parser.add_argument(
        "--output-dir", default="training/output", help="Output directory"
    )
    parser.add_argument("--input-size", type=int, default=256)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--val-split", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--freeze-base-epochs", type=int, default=5)
    parser.add_argument("--base-lr", type=float, default=1e-3)
    parser.add_argument("--fine-tune-lr", type=float, default=1e-4)
    parser.add_argument("--no-letterbox", action="store_true")
    return parser.parse_args()


def load_annotations(path):
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("annotations.json is missing items")

    validated = []
    for item in items:
        image_name = item.get("image")
        width = item.get("width")
        height = item.get("height")
        landmarks = item.get("landmarks")
        if not image_name or not landmarks:
            continue
        if not width or not height:
            continue
        if not all(key in landmarks for key in ORDER):
            continue
        validated.append(item)

    if not validated:
        raise ValueError("No valid annotations found.")
    return validated


def split_items(items, val_split, seed):
    rng = random.Random(seed)
    shuffled = items[:]
    rng.shuffle(shuffled)
    val_count = max(1, int(len(shuffled) * val_split)) if val_split > 0 else 0
    val_items = shuffled[:val_count]
    train_items = shuffled[val_count:]
    return train_items, val_items


def build_model(input_size, num_points):
    base = tf.keras.applications.MobileNetV2(
        input_shape=(input_size, input_size, 3),
        include_top=False,
        weights="imagenet",
    )
    x = tf.keras.layers.GlobalAveragePooling2D()(base.output)
    x = tf.keras.layers.Dropout(0.2)(x)
    outputs = tf.keras.layers.Dense(
        num_points * 2, activation="sigmoid"
    )(x)
    model = tf.keras.Model(base.input, outputs)
    return model, base


def mean_point_error(num_points):
    def metric(y_true, y_pred):
        y_true = tf.reshape(y_true, (-1, num_points, 2))
        y_pred = tf.reshape(y_pred, (-1, num_points, 2))
        return tf.reduce_mean(tf.norm(y_true - y_pred, axis=-1))

    return metric


def compile_model(model, lr, num_points):
    model.compile(
        optimizer=tf.keras.optimizers.Adam(lr),
        loss="mse",
        metrics=[mean_point_error(num_points)],
    )


def make_dataset(items, images_dir, input_size, letterbox, batch_size):
    def generator():
        for item in items:
            image_path = images_dir / item["image"]
            if not image_path.exists():
                continue
            image = Image.open(image_path).convert("RGB")
            image_array, target = preprocess_sample(
                image, item, input_size, letterbox
            )
            yield image_array, target

    output_signature = (
        tf.TensorSpec(
            shape=(input_size, input_size, 3), dtype=tf.float32
        ),
        tf.TensorSpec(shape=(len(ORDER) * 2,), dtype=tf.float32),
    )
    dataset = tf.data.Dataset.from_generator(
        generator, output_signature=output_signature
    )
    dataset = dataset.shuffle(buffer_size=256)
    dataset = dataset.batch(batch_size).prefetch(tf.data.AUTOTUNE)
    return dataset


def preprocess_sample(image, item, input_size, letterbox):
    original_width = item["width"]
    original_height = item["height"]

    if image.width != original_width or image.height != original_height:
        image = image.resize((original_width, original_height), Image.BILINEAR)

    if letterbox:
        processed, scale, offset_x, offset_y = letterbox_image(
            image, input_size
        )
    else:
        processed = image.resize((input_size, input_size), Image.BILINEAR)
        scale = input_size / original_width
        offset_x = 0
        offset_y = 0

    processed_array = np.asarray(processed).astype("float32") / 255.0

    coords = []
    for key in ORDER:
        x, y = item["landmarks"][key]
        x = x * scale + offset_x
        y = y * scale + offset_y
        coords.extend([x / input_size, y / input_size])

    return processed_array, np.array(coords, dtype="float32")


def letterbox_image(image, input_size):
    original_width, original_height = image.size
    scale = min(input_size / original_width, input_size / original_height)
    new_width = int(round(original_width * scale))
    new_height = int(round(original_height * scale))
    resized = image.resize((new_width, new_height), Image.BILINEAR)

    canvas = Image.new("RGB", (input_size, input_size), (0, 0, 0))
    offset_x = int((input_size - new_width) / 2)
    offset_y = int((input_size - new_height) / 2)
    canvas.paste(resized, (offset_x, offset_y))
    return canvas, scale, offset_x, offset_y


def save_config(output_dir, input_size, letterbox):
    config = {
        "inputSize": {"width": input_size, "height": input_size},
        "letterbox": letterbox,
        "order": ORDER,
        "output": {"normalized": True, "stride": 2},
    }
    config_path = output_dir / "model_config.json"
    with open(config_path, "w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2)


def main():
    args = parse_args()
    items = load_annotations(args.data)
    train_items, val_items = split_items(
        items, args.val_split, args.seed
    )

    images_dir = Path(args.images_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    letterbox = not args.no_letterbox

    train_ds = make_dataset(
        train_items, images_dir, args.input_size, letterbox, args.batch_size
    )
    val_ds = make_dataset(
        val_items, images_dir, args.input_size, letterbox, args.batch_size
    )

    model, base = build_model(args.input_size, len(ORDER))

    callbacks = [
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(output_dir / "best.weights.h5"),
            save_best_only=True,
            monitor="val_loss",
        )
    ]

    total_epochs = max(args.epochs, args.freeze_base_epochs)
    if args.freeze_base_epochs > 0:
        base.trainable = False
        compile_model(model, args.base_lr, len(ORDER))
        model.fit(
            train_ds,
            validation_data=val_ds,
            epochs=args.freeze_base_epochs,
            callbacks=callbacks,
        )

    base.trainable = True
    compile_model(model, args.fine_tune_lr, len(ORDER))
    model.fit(
        train_ds,
        validation_data=val_ds,
        initial_epoch=min(args.freeze_base_epochs, total_epochs),
        epochs=total_epochs,
        callbacks=callbacks,
    )

    saved_model_dir = output_dir / "saved_model"
    model.save(saved_model_dir)
    save_config(output_dir, args.input_size, letterbox)

    print(f"Saved model to {saved_model_dir}")


if __name__ == "__main__":
    main()
