from flask import Flask, request, jsonify, render_template
from transformers import AutoConfig,  AutoTokenizer, AutoModelForSeq2SeqLM, BartTokenizer, BartForConditionalGeneration
import torch
import json
import os
from pathlib import Path

app = Flask(__name__)


model_path = r"C:\Users\Wilso\OneDrive\Desktop\ToxificationExtension\Detoxifier_Generation\paragedi-detox-finetuned"

from transformers import BartTokenizer

tokenizer = BartTokenizer(
    vocab_file=r"C:\Users\Wilso\OneDrive\Desktop\ToxificationExtension\Detoxifier_Generation\paragedi-detox-finetuned\checkpoint-21\vocab.json",
    merges_file=r"C:\Users\Wilso\OneDrive\Desktop\ToxificationExtension\Detoxifier_Generation\paragedi-detox-finetuned\checkpoint-21\merges.txt"
)

model_path = r"C:\Users\Wilso\OneDrive\Desktop\ToxificationExtension\Detoxifier_Generation\paragedi-detox-finetuned\checkpoint-21"

config = AutoConfig.from_pretrained(model_path, local_files_only=True)

model = BartForConditionalGeneration.from_pretrained(
    model_path,
    config=config,
    local_files_only=True
)


model.to("cuda" if torch.cuda.is_available() else "cpu")


model.eval()

# Detoxification with ParaGeDi
def generate_response(toxic_input):
    prompt = f"Toxic: {toxic_input}\nNeutral:"
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    with torch.no_grad(): 
        output = model.generate(
            **inputs,
            max_new_tokens=min(int(len(toxic_input) * 1.2), 100),
            temperature=0.7,
            top_p=0.9,
            do_sample=True,
            pad_token_id=tokenizer.pad_token_id
        )

    decoded = tokenizer.decode(output[0], skip_special_tokens=True)
    response = decoded.split("Neutral:")[-1].strip().split("\n")[0]
    return response

# Store feedback
def save_feedback(toxic_input, detox_response, rating):
    prompt = f"Toxic Version: {toxic_input}\nNeutral Version: {detox_response}"
    feedback = {
        "text": prompt,
        "rating": int(rating)
    }
    os.makedirs("feedback", exist_ok=True)
    with open("feedback/train.jsonl", "a") as f:
        f.write(json.dumps(feedback) + "\n")

@app.route("/", methods=["GET", "POST"])
def home():
    detox_response = ""
    if request.method == "POST":
        toxic_input = request.form.get("message")
        detox_response = generate_response(toxic_input)
    return render_template("index.html", response=detox_response)

@app.route("/rate", methods=["POST"])
def rate():
    toxic_input = request.form.get("message")
    detox_response = request.form.get("response")
    rating = request.form.get("rating")
    save_feedback(toxic_input, detox_response, rating)
    return "Thanks for your feedback!"

if __name__ == "__main__":
    app.run(debug=False)