from flask import Flask, request, jsonify, render_template
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch
import json
import os

app = Flask(__name__)

# Load LLaMA 2 model and tokenizer
model_name = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(model_name, device_map="auto")
model.eval()

def generate_response(toxic_input):
    print("Starting generation…")
    prompt = f"Rewrite the following sentence to be kind and respectful:\n{toxic_input}\nRewritten:"
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    print("Inputs ready:", inputs.input_ids.shape)

    input_length = inputs.input_ids.shape[1]
    target_length = min(input_length + 5, 50)

    with torch.no_grad():
        output = model.generate(
            **inputs,
            max_new_tokens=target_length,
            temperature=0.7,
            top_p=0.9,
            do_sample=True,
            pad_token_id=tokenizer.pad_token_id
        )

    decoded = tokenizer.decode(output[0], skip_special_tokens=True)
    print("Decoded output:", decoded)

    # Extract only the rewritten part
    if "Rewritten:" in decoded:
        response = decoded.split("Rewritten:")[-1].strip().split("\n")[0]
    else:
        response = decoded.strip().split("\n")[-1]

    print("Generated:", response)
    return response

# Store feedback
def save_feedback(toxic_input, detox_response, rating):
    prompt = f"[INST] Rewrite the following toxic sentence in a kind and respectful way:\n{toxic_input} [/INST] Response: {detox_response}"
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