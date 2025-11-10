from flask import Flask, request, jsonify, render_template
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
import torch
from pathlib import Path
import json
import os

app = Flask(__name__)

# Load fine-tuned T5 model
model_path = Path(__file__).parent / "t5-small-detox-finetuned"
tokenizer = AutoTokenizer.from_pretrained(model_path)
model = AutoModelForSeq2SeqLM.from_pretrained(model_path)
model.to("cuda" if torch.cuda.is_available() else "cpu")
model.eval()

# Detoxification function
def generate_response(toxic_input):
    # For T5, prefix is usually "detoxify: "
    prompt = f"detoxify: {toxic_input}"
    inputs = tokenizer(prompt, return_tensors="pt", truncation=True, padding="max_length", max_length=512).to(model.device)
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
    return decoded.strip()

# Feedback saving
def save_feedback(toxic_input, detox_response, rating):
    """Save user ratings to user_ratings.json for retraining."""
    feedback = {
        "toxic": toxic_input.strip(),
        "detoxified": detox_response.strip(),
        "rating": int(rating)
    }
    ratings_file = Path(__file__).parent / "user_ratings.json"
    
    # Load existing ratings or create new list
    ratings = []
    if ratings_file.exists():
        try:
            with open(ratings_file, "r") as f:
                ratings = json.load(f)
        except:
            ratings = []
    
    # Append new rating
    ratings.append(feedback)
    
    # Save back to file
    with open(ratings_file, "w") as f:
        json.dump(ratings, f, indent=2)
    
    # Also keep legacy feedback format for reference
    legacy_feedback = {
        "text": f"Toxic Version: {toxic_input}\nNeutral Version: {detox_response}",
        "rating": int(rating)
    }
    os.makedirs("feedback", exist_ok=True)
    with open("feedback/train.jsonl", "a") as f:
        f.write(json.dumps(legacy_feedback) + "\n")

# Routes
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
