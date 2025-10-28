import os
import torch
import pandas as pd
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from torch.optim import AdamW
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
from tqdm import tqdm

# === CONFIG ===
DATA_FILE = "classificationAI/classifyData.csv"
MODEL_NAME = "distilbert-base-uncased"
NUM_EPOCHS = 1
BATCH_SIZE = 32
MAX_LENGTH = 256
LR = 5e-5
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("Using device:", DEVICE)
OUTPUT_DIR = "./ClassificationModel"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# === LOAD DATA ===
df = pd.read_csv(DATA_FILE).dropna(subset=["text", "label"]).reset_index(drop=True)
le = LabelEncoder()
df["label"] = le.fit_transform(df["label"])

# === DATASET CLASS ===
class TextDataset(Dataset):
    def __init__(self, texts, labels, tokenizer):
        self.encodings = tokenizer(texts, truncation=True, padding="max_length", max_length=MAX_LENGTH)
        self.labels = labels

    def __getitem__(self, idx):
        item = {key: torch.tensor(val[idx]) for key, val in self.encodings.items()}
        item["labels"] = torch.tensor(self.labels[idx])
        return item

    def __len__(self):
        return len(self.labels)

# === TOKENIZER ===
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

# === SPLIT DATA ===
train_texts, val_texts, train_labels, val_labels = train_test_split(
    df["text"].tolist(), df["label"].tolist(), test_size=0.2, random_state=42
)

train_dataset = TextDataset(train_texts, train_labels, tokenizer)
val_dataset = TextDataset(val_texts, val_labels, tokenizer)

train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE)

# === MODEL ===
model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, num_labels=len(le.classes_))
model.to(DEVICE)
optimizer = AdamW(model.parameters(), lr=LR)

# === STEP-LEVEL METRICS LOGGING WITH REAL-TIME DISPLAY ===
step_log_path = "step_metrics.txt"
with open(step_log_path, "w", encoding="utf-8") as log_file:
    step = 0
    model.train()
    for epoch in range(NUM_EPOCHS):
        print(f"\nEpoch {epoch + 1}/{NUM_EPOCHS}")
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

            # === VALIDATION ===
            model.eval()
            val_preds, val_labels_epoch = [], []
            with torch.no_grad():
                for val_batch in val_loader:
                    val_batch = {k: v.to(DEVICE) for k, v in val_batch.items()}
                    val_outputs = model(**val_batch)
                    val_logits = val_outputs.logits
                    val_preds.extend(torch.argmax(val_logits, dim=1).cpu().numpy())
                    val_labels_epoch.extend(val_batch["labels"].cpu().numpy())
            val_acc = accuracy_score(val_labels_epoch, val_preds)
            model.train()

            # === LOG + PRINT ===
            log_line = f"step={step}\tepoch={epoch}\tloss={loss.item():.4f}\ttrain_acc={train_acc:.4f}\tval_acc={val_acc:.4f}"
            log_file.write(log_line + "\n")
            print(log_line)
            step += 1


# === SAVE MODEL ===
model.save_pretrained(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)
print(f"\nModel saved to {OUTPUT_DIR}")
print(f"Step metrics logged to {step_log_path}")