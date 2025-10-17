from flask import Flask, request, jsonify, render_template
from transformers import GPT2LMHeadModel, GPT2Tokenizer
import torch
import json
import os

app = Flask(__name__)

# Load model and tokenizer
tokenizer = GPT2Tokenizer.from_pretrained("gpt2")
tokenizer.add_special_tokens({'pad_token': '[PAD]', 'additional_special_tokens': ['<TOXIC>', '<POSITIVE>']})
model = GPT2LMHeadModel.from_pretrained("gpt2")
model.resize_token_embeddings(len(tokenizer))
model.eval()  # Set model to evaluation mode

# Generate detoxified response
def generate_response(toxic_input):
    prompt = f"Rewrite the following toxic sentence in a kind and respectful way:\n{toxic_input}\nResponse:"
    input_ids = tokenizer(prompt, return_tensors="pt", padding=True).input_ids
    with torch.no_grad():
        output = model.generate(input_ids, max_length=64, pad_token_id=tokenizer.pad_token_id)
    response = tokenizer.decode(output[0], skip_special_tokens=True)
    return response

# Store feedback
def save_feedback(toxic_input, detox_response, rating):
    feedback = {
        "input": toxic_input,
        "response": detox_response,
        "rating": rating
    }
    os.makedirs("feedback", exist_ok=True)
    with open("feedback/ratings.json", "a") as f:
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
    app.run(debug=True)
