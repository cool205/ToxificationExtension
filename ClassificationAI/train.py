import os, math, time, csv, json
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import accuracy_score, classification_report
from transformers import AutoTokenizer, AutoConfig, AutoModelForSequenceClassification
from torch.optim import AdamW

# === CONFIG ===
DATA_FILE = "classificationAI/classifyData.csv"
MODEL_NAME = "distilbert-base-uncased"
NUM_EPOCHS = 10

DEFAULT_BATCH_SIZE = 32        # smaller batch size
DEFAULT_LR = 5e-5              # Hugging Face default
DEFAULT_MAX_LENGTH = 256
DEFAULT_DROPOUT = 0.5

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("Using device:", DEVICE)

OUTPUT_DIR = "./ClassificationModel"
RUNS_DIR = os.path.join(OUTPUT_DIR, "runs")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(RUNS_DIR, exist_ok=True)

# === DATASET CLASS ===
class TextDataset(Dataset):
    def __init__(self, texts, labels, tokenizer, max_length=256):
        self.encodings = tokenizer(
            texts, truncation=True, padding="max_length", max_length=max_length
        )
        self.labels = labels
        self.keys = list(self.encodings.keys())

    def __getitem__(self, idx):
        item = {key: torch.tensor(self.encodings[key][idx]) for key in self.keys}
        item["labels"] = torch.tensor(self.labels[idx], dtype=torch.long)
        return item

    def __len__(self):
        return len(self.labels)

# === EVALUATION ===
def evaluate_loader(model, data_loader, device):
    model.eval()
    loss_fn = nn.CrossEntropyLoss()
    losses, preds_all, labels_all = [], [], []
    with torch.no_grad():
        for batch in data_loader:
            batch = {k: v.to(device) for k, v in batch.items()}
            outputs = model(**batch)
            logits = outputs.logits
            loss = loss_fn(logits, batch["labels"])
            losses.append(loss.item())
            preds_all.extend(torch.argmax(logits, dim=1).cpu().numpy())
            labels_all.extend(batch["labels"].cpu().numpy())
    avg_loss = float(np.mean(losses)) if losses else float("nan")
    acc = float(accuracy_score(labels_all, preds_all)) if labels_all else float("nan")
    return avg_loss, acc, labels_all, preds_all

# === SAVE MODEL + LABEL MAP ===
def save_model(model, tokenizer, label_encoder, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    # Convert to JSON‑friendly types
    label_map = {int(i): str(label) for i, label in enumerate(label_encoder.classes_)}
    with open(os.path.join(output_dir, "label_map.json"), "w") as f:
        json.dump(label_map, f)
    print(f"Model + tokenizer + label_map saved to {output_dir}")

# === TRAINING ===
def train_one(batch_size, learning_rate, max_length, dropout, num_epochs, model_name, data_file, output_dir):
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    # load data
    df = pd.read_csv(data_file).dropna(subset=["text", "label"]).reset_index(drop=True)
    df["label"] = df["label"].astype(int)   # ensure int labels
    le = LabelEncoder()
    df["label"] = le.fit_transform(df["label"])

    print("Label distribution:\n", df["label"].value_counts())

    # split
    train_texts, val_texts, train_labels, val_labels = train_test_split(
        df["text"].tolist(), df["label"].tolist(),
        test_size=0.2, random_state=42, stratify=df["label"].tolist()
    )

    train_dataset = TextDataset(train_texts, train_labels, tokenizer, max_length=max_length)
    val_dataset = TextDataset(val_texts, val_labels, tokenizer, max_length=max_length)
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size)

    # model config
    config = AutoConfig.from_pretrained(model_name, num_labels=len(le.classes_))
    if hasattr(config, "hidden_dropout_prob"):
        config.hidden_dropout_prob = dropout
    if hasattr(config, "attention_probs_dropout_prob"):
        config.attention_probs_dropout_prob = dropout

    model = AutoModelForSequenceClassification.from_pretrained(model_name, config=config)
    model.to(DEVICE)
    optimizer = AdamW(model.parameters(), lr=learning_rate)
    loss_fn = nn.CrossEntropyLoss()

    # logging setup
    run_name = f"bs{batch_size}_lr{learning_rate:.0e}_ml{max_length}_do{dropout}"
    run_output = os.path.join(RUNS_DIR, run_name)
    os.makedirs(run_output, exist_ok=True)
    step_log_path = os.path.join(run_output, "step_metrics.txt")
    step_csv_path = os.path.join(run_output, "step_summary.csv")

    with open(step_log_path, "w", encoding="utf-8") as log_file, open(step_csv_path, "w", newline='', encoding="utf-8") as csvf:
        csv_writer = csv.writer(csvf)
        csv_writer.writerow(["step", "epoch", "loss", "train_acc", "val_acc", "timestamp"])

        step = 0
        for epoch in range(num_epochs):
            print(f"\nEpoch {epoch+1}/{num_epochs}")
            model.train()
            for batch in train_loader:
                batch = {k: v.to(DEVICE) for k, v in batch.items()}
                outputs = model(**batch)
                loss = outputs.loss
                logits = outputs.logits
                loss.backward()
                optimizer.step()
                optimizer.zero_grad()

                preds = torch.argmax(logits, dim=1).cpu().numpy()
                labels = batch["labels"].cpu().numpy()
                train_acc = accuracy_score(labels, preds)

                # log every 5 steps
                if step % 5 == 0:
                    val_loss, val_acc, val_labels, val_preds = evaluate_loader(model, val_loader, DEVICE)
                    log_line = f"step={step}\tepoch={epoch}\tloss={loss.item():.4f}\ttrain_acc={train_acc:.4f}\tval_acc={val_acc:.4f}"
                    print(log_line)
                    log_file.write(log_line + "\n")
                    csv_writer.writerow([step, epoch, float(loss.item()), float(train_acc), float(val_acc), time.time()])
                step += 1

            # end of epoch validation summary
            val_loss, val_acc, val_labels, val_preds = evaluate_loader(model, val_loader, DEVICE)
            print(f"Epoch {epoch+1} summary: val_loss={val_loss:.4f}, val_acc={val_acc:.4f}")
            target_names = [str(c) for c in le.classes_]
            print(classification_report(val_labels, val_preds, target_names=target_names))

    print("Training finished. Saving final model.")
    save_model(model, tokenizer, le, output_dir)

# === MAIN ===
if __name__ == "__main__":
    final_output = os.path.join(OUTPUT_DIR, "final_model")
    train_one(
        batch_size=DEFAULT_BATCH_SIZE,
        learning_rate=DEFAULT_LR,
        max_length=DEFAULT_MAX_LENGTH,
        dropout=DEFAULT_DROPOUT,
        num_epochs=NUM_EPOCHS,
        model_name=MODEL_NAME,
        data_file=DATA_FILE,
        output_dir=final_output,
    )