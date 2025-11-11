from flask import Flask, request, jsonify, render_template
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
import torch
from pathlib import Path
import json
import os
import subprocess
import sys

app = Flask(__name__)

# Load fine-tuned T5 model
model_path = "DetoxifierAI/t5-small-detox-finetuned"
tokenizer = AutoTokenizer.from_pretrained(model_path)
model = AutoModelForSeq2SeqLM.from_pretrained(model_path)
model.to("cuda" if torch.cuda.is_available() else "cpu")
model.eval()

# Detoxification function (generate multiple options for DPO preference)
def generate_responses(toxic_input, num_options=3):
    """Generate multiple detoxified options for user to choose best one."""
    prompt = f"detoxify: {toxic_input}"
    inputs = tokenizer(prompt, return_tensors="pt", truncation=True, padding="max_length", max_length=512).to(model.device)
    
    responses = []
    with torch.no_grad():
        for _ in range(num_options):
            output = model.generate(
                **inputs,
                max_new_tokens=min(int(len(toxic_input) * 1.2), 100),
                temperature=0.9,  # Higher temperature for diversity
                top_p=0.95,
                do_sample=True,
                pad_token_id=tokenizer.pad_token_id
            )
            decoded = tokenizer.decode(output[0], skip_special_tokens=True)
            responses.append(decoded.strip())
    
    return responses

# Preference saving for DPO
def save_preference(toxic_input, chosen_response, rejected_responses):
    """Save user preference (chosen vs rejected) for DPO training."""
    preference = {
        "toxic": toxic_input.strip(),
        "chosen": chosen_response.strip(),
        "rejected": rejected_responses  # List of rejected options
    }
    prefs_file = Path(__file__).parent / "user_preferences.json"
    
    # Load existing preferences or create new list
    preferences = []
    if prefs_file.exists():
        try:
            with open(prefs_file, "r") as f:
                preferences = json.load(f)
        except:
            preferences = []
    
    # Append new preference
    preferences.append(preference)
    
    # Save back to file
    with open(prefs_file, "w") as f:
        json.dump(preferences, f, indent=2)
    
    return len(preferences)

# Routes
@app.route("/", methods=["GET", "POST"])
def home():
    options = []
    toxic_input = ""
    if request.method == "POST":
        toxic_input = request.form.get("message", "").strip()
        if toxic_input:
            options = generate_responses(toxic_input, num_options=3)
    return render_template("index.html", toxic_input=toxic_input, options=options)

@app.route("/choose", methods=["POST"])
def choose_preference():
    """User selects best option (chosen) and rejects others for DPO training."""
    data = request.get_json()
    toxic_input = data.get("toxic", "").strip()
    chosen = data.get("chosen", "").strip()
    all_options = data.get("options", [])
    
    if not toxic_input or not chosen or not all_options:
        return jsonify({"error": "Missing data"}), 400
    
    # Rejected options are all options except the chosen one
    rejected = [opt for opt in all_options if opt != chosen]
    
    if not rejected:
        return jsonify({"error": "Need at least one rejected option"}), 400
    
    # Save preference for DPO
    num_saved = save_preference(toxic_input, chosen, rejected)
    
    return jsonify({
        "success": True,
        "message": f"Preference saved! Total preferences: {num_saved}",
        "chosen": chosen,
        "rejected_count": len(rejected)
    })

@app.route("/retrain", methods=["POST"])
def retrain_model():
    """Trigger DPO retraining with user preferences."""
    prefs_file = Path(__file__).parent / "user_preferences.json"
    
    if not prefs_file.exists():
        return jsonify({"error": "No preferences saved yet"}), 400
    
    try:
        with open(prefs_file, "r") as f:
            prefs = json.load(f)
        
        if len(prefs) == 0:
            return jsonify({"error": "No preferences to train on"}), 400
        
        # Run after_train.py in background
        after_train_path = Path(__file__).parent.parent / "after_train.py"
        
        # Use subprocess to run the training script
        proc = subprocess.Popen(
            [sys.executable, str(after_train_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Wait for completion (you can also make this async for longer training)
        stdout, stderr = proc.communicate(timeout=3600)  # 1 hour timeout
        
        if proc.returncode == 0:
            return jsonify({
                "success": True,
                "message": f"Retraining complete! Trained on {len(prefs)} preference pairs.",
                "output": stdout
            })
        else:
            return jsonify({
                "error": "Retraining failed",
                "stderr": stderr
            }), 500
    
    except subprocess.TimeoutExpired:
        proc.kill()
        return jsonify({
            "error": "Retraining timeout (exceeded 1 hour)"
        }), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=False)
