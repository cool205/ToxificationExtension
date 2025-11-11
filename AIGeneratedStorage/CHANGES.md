# Code Changes - Before vs After

## Summary of Changes

### reinforcementTraining/app.py

#### BEFORE: Single Option + Rating
```python
# Old: Generate one option
def generate_response(toxic_input):
    prompt = f"detoxify: {toxic_input}"
    inputs = tokenizer(prompt, ...)
    with torch.no_grad():
        output = model.generate(**inputs, temperature=0.7)
    return tokenizer.decode(output[0], skip_special_tokens=True).strip()

# Old: Save rating
def save_feedback(toxic_input, detox_response, rating):
    feedback = {
        "text": f"Toxic: {toxic_input}\nNeutral: {detox_response}",
        "rating": int(rating)
    }
    # Saves 1-5 star rating

# Old: Routes
@app.route("/rate", methods=["POST"])
def rate():
    toxic_input = request.form.get("message")
    detox_response = request.form.get("response")
    rating = request.form.get("rating")
    save_feedback(toxic_input, detox_response, rating)
```

#### AFTER: 3 Options + Preference Selection + Auto Retrain
```python
# New: Generate 3 diverse options
def generate_responses(toxic_input, num_options=3):
    prompt = f"detoxify: {toxic_input}"
    inputs = tokenizer(prompt, ...)
    responses = []
    with torch.no_grad():
        for _ in range(num_options):
            output = model.generate(**inputs, temperature=0.9)  # Higher temp for diversity
            decoded = tokenizer.decode(output[0], skip_special_tokens=True)
            responses.append(decoded.strip())
    return responses

# New: Save preference (chosen vs rejected)
def save_preference(toxic_input, chosen_response, rejected_responses):
    preference = {
        "toxic": toxic_input.strip(),
        "chosen": chosen_response.strip(),
        "rejected": rejected_responses  # List
    }
    # Saves to user_preferences.json

# New: Preference selection route
@app.route("/choose", methods=["POST"])
def choose_preference():
    data = request.get_json()
    toxic = data.get("toxic")
    chosen = data.get("chosen")
    options = data.get("options")
    rejected = [opt for opt in options if opt != chosen]
    save_preference(toxic, chosen, rejected)
    return jsonify({"success": True, ...})

# New: Auto-retrain route
@app.route("/retrain", methods=["POST"])
def retrain_model():
    after_train_path = Path(__file__).parent.parent / "after_train.py"
    proc = subprocess.Popen([sys.executable, str(after_train_path)], ...)
    stdout, stderr = proc.communicate(timeout=3600)
    if proc.returncode == 0:
        return jsonify({"success": True, "message": "..."})
```

### DetoxifierAI/after_train.py

#### BEFORE: Preference-based (but incomplete)
```python
from transformers import Trainer, Seq2SeqTrainingArguments
# Uses standard trainer for supervised fine-tuning
```

#### AFTER: DPO Trainer
```python
from trl import DPOTrainer, DPOConfig

# New: Load preferences
def load_preferences(path):
    with open(path, "r") as f:
        data = json.load(f)
    rows = []
    for item in data:
        toxic = str(item.get("toxic", "")).strip()
        chosen = str(item.get("chosen", "")).strip()
        rejected_list = item.get("rejected", [])
        if toxic and chosen and rejected_list:
            rejected = rejected_list[0] if isinstance(rejected_list, list) else rejected_list
            rows.append({
                "prompt": toxic,
                "chosen": chosen,
                "rejected": rejected
            })
    return Dataset.from_list(rows)

dataset = load_preferences(PREFS_FILE)

# New: DPO Config (not Seq2SeqTrainingArguments)
config = DPOConfig(
    output_dir=MODEL_DIR,
    learning_rate=1e-6,        # Very low for fine-tuning
    per_device_train_batch_size=4,
    num_train_epochs=2,        # Quick convergence
    logging_steps=5,
    save_strategy="epoch",
)

# New: DPO Trainer (not standard Trainer)
trainer = DPOTrainer(
    model=model,
    ref_model=None,
    args=config,
    beta=0.1,                  # Preference loss strength
    tokenizer=tokenizer,
    train_dataset=dataset,
    eval_dataset=None,
)

# Same training call
trainer.train()
```

### templates/index.html

#### BEFORE: Single Rating
```html
{% if response %}
  <h2>Detoxified Response:</h2>
  <p>{{ response }}</p>
  
  <form action="/rate" method="POST">
    <input type="hidden" name="message" value="{{ request.form.message }}">
    <input type="hidden" name="response" value="{{ response }}">
    <select name="rating">
      <option value="5">👍👍👍👍👍</option>
      <option value="4">👍👍👍👍</option>
      ...
    </select>
    <button>Submit Rating</button>
  </form>
{% endif %}
```

#### AFTER: 3 Options + Preference Selection
```html
{% if options %}
  <h2>Choose the Best Detoxified Option:</h2>
  <p>Your toxic input: <strong>{{ toxic_input }}</strong></p>
  
  <div class="options-container">
    {% for option in options %}
      <button type="button" class="option-button" onclick="selectOption(...)">
        Option {{ loop.index }}: {{ option }}
      </button>
    {% endfor %}
  </div>
  
  <button type="button" onclick="submitChoice()" style="background-color: #4CAF50;">
    ✓ Submit Choice
  </button>
  
  <div id="status"></div>
{% endif %}

<div class="retrain-section">
  <button type="button" onclick="retrainModel()" style="background-color: #2196F3;">
    🔄 Retrain Model (DPO)
  </button>
</div>

<script>
function selectOption(button, toxicInput, allOptions, option) {
    // Remove previous selection
    document.querySelectorAll('.option-button').forEach(btn => btn.classList.remove('selected'));
    // Mark this button as selected
    button.classList.add('selected');
    selectedOption = option;
}

function submitChoice() {
    const data = {
        toxic: toxicInput,
        chosen: selectedOption,
        options: allOptions
    };
    fetch('/choose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(result => {
        // Show success/error
    });
}

function retrainModel() {
    fetch('/retrain', { method: 'POST' })
    .then(response => response.json())
    .then(result => {
        // Show training status
    });
}
</script>
```

## Key Differences Summary

| Feature | Before | After |
|---------|--------|-------|
| **Generation** | 1 option | 3 options (diverse) |
| **Temperature** | 0.7 (low) | 0.9 (high for diversity) |
| **Feedback Type** | 5-star rating | Binary preference |
| **Data Saved** | `{toxic, detoxified, rating}` | `{toxic, chosen, rejected}` |
| **Training Algorithm** | Supervised (standard Trainer) | DPO (DPOTrainer) |
| **Learning Rate** | 3e-05 (normal) | 1e-6 (fine-tuning) |
| **Epochs** | 4 | 2 |
| **Retraining** | Manual | Automatic (/retrain endpoint) |
| **Frontend** | HTML form | AJAX + JS |

## Why These Changes?

1. **3 Options**: Users can compare and choose best
2. **Higher Temperature**: Generates diverse outputs (not just 1 best)
3. **Binary Preference**: Simpler signal, better for learning
4. **DPO Algorithm**: Proven RLHF-inspired method (better than supervised)
5. **Lower LR**: Fine-tuning existing model (not training from scratch)
6. **Auto Retrain**: One-click retraining without terminal
7. **AJAX UI**: Real-time feedback without page reload

## Migration Path

If you had existing user feedback:

**Old format** (ratings):
```json
{"toxic": "text", "detoxified": "output", "rating": 5}
```

**New format** (preferences):
```json
{"toxic": "text", "chosen": "output1", "rejected": ["output2", "output3"]}
```

You could write a migration script if needed, but DPO works best with fresh preference data collected from users.

---

For execution examples, see `QUICKSTART.md`
