import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Dense, Embedding, GlobalAveragePooling1D
from tensorflow.keras.preprocessing.text import Tokenizer
from tensorflow.keras.preprocessing.sequence import pad_sequences
import numpy as np


import pandas as pd
df = pd.read_csv("AI_Training_Scripts/data.csv")
texts = df["text"].astype(str).tolist()
labels = df["is_toxic"].astype(str).tolist()

tokenizer = Tokenizer(num_words=5000, oov_token="<OOV>")
tokenizer.fit_on_texts(texts)
sequences = tokenizer.texts_to_sequences(texts)
padded = pad_sequences(sequences, padding='post', maxlen=100)

label_index = {label: i for i, label in enumerate(set(labels))}
y = [label_index[label] for label in labels]

model = Sequential([
    Embedding(5000, 16, input_length=100),
    GlobalAveragePooling1D(),
    Dense(16, activation='relu'),
    Dense(len(label_index), activation='softmax')
])


padded = np.array(padded)
y = np.array(y)

model.compile(loss='sparse_categorical_crossentropy', optimizer='adam', metrics=['accuracy'])
# Train the model and capture history
history = model.fit(padded, y, epochs=10, verbose=2)

# Write accuracy and loss for each epoch to a text file
with open(r"AI_Training_Scripts/run_history.txt", "w") as f:
    for epoch in range(len(history.history['accuracy'])):
        acc = history.history['accuracy'][epoch]
        loss = history.history['loss'][epoch]
        f.write(f"Epoch {epoch+1}: Accuracy = {acc:.4f}, Loss = {loss:.4f}\n")

model.save("text_model.keras")
import pickle
with open("tokenizer.pkl", "wb") as f:
    pickle.dump(tokenizer, f)
