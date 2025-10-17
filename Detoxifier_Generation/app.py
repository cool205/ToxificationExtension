from flask import Flask, request, jsonify, render_template
from transformers import TFGPT2LMHeadModel, GPT2Tokenizer
import tensorflow as tf
import json
import os

app = Flask(__name__)

# Load model and tokenizer
tokenizer = GPT2Tokenizer.from_pretrained("gpt2")
tokenizer.add_special_tokens({'pad_token': '[PAD]', 'additional_special_tokens': ['<TOXIC>', '<POSITIVE>']})
model = TFGPT2LMHeadModel.from_pretrained("gpt2")
model.resize_token_embeddings(len(tokenizer))

# Generate detoxified response
def generate_response(toxic_input):
    prompt = f"<TOXIC> {toxic_input} <POSITIVE>"
    input_ids = tokenizer(prompt, return_tensors="tf", padding=True).input_ids
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
