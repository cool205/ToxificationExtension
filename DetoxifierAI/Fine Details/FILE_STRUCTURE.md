# Complete DPO System File Structure

```
ToxificationExtension/
│
├── Chrome Extension (USE THIS)/
│   ├── background.js          # Extension service worker
│   ├── content.js             # Content script for webpage scanning
│   ├── manifest.json          # Extension configuration
│   ├── popup.html             # Popup UI
│   ├── popup.js               # Popup script
│   └── popup.css              # Popup styling
│
└── DetoxifierAI/
    │
    ├── 📋 DOCUMENTATION (Read These First!)
    │   ├── START_HERE.md                   ⭐ Main entry point
    │   ├── QUICKSTART.md                   ⭐ Step-by-step guide
    │   ├── ARCHITECTURE.md                 ⭐ System design & diagrams
    │   ├── README_DPO.md                   📖 Comprehensive docs
    │   ├── IMPLEMENTATION_SUMMARY.md       📋 High-level overview
    │   ├── CHANGES.md                      🔄 Before/after code
    │   └── CHECKLIST.md                    ✅ Verification
    │
    ├── 🤖 TRAINING SCRIPTS (Core System)
    │   ├── init_train.py                   Training: Supervised (20 epochs)
    │   │   └─ Input: paradetox.tsv + paradetox_cannot_rewrite.tsv
    │   │   └─ Output: reinforcementTraining/t5-small-detox-finetuned/
    │   │
    │   ├── after_train.py                  Training: DPO (2 epochs)
    │   │   └─ Input: reinforcementTraining/user_preferences.json
    │   │   └─ Output: Updated model checkpoint
    │   │
    │   └── requirements.txt                Python dependencies
    │       ├── torch>=2.0.0
    │       ├── transformers>=4.35.0
    │       ├── trl>=0.7.0                  ← DPO support
    │       ├── peft>=0.7.0
    │       ├── flask>=2.3.0
    │       ├── datasets>=2.14.0
    │       ├── pandas>=1.5.0
    │       └── numpy>=1.24.0
    │
    ├── 📊 TRAINING DATA
    │   ├── paradetox.tsv                   19,226 toxic↔neutral pairs
    │   │   └─ Columns: toxic, neutral1, neutral2, neutral3
    │   │   └─ Used: all 3 neutral variants
    │   │
    │   └── paradetox_cannot_rewrite.tsv    517 unrewritable examples
    │       └─ Columns: toxic
    │       └─ Used: marked as "none" target
    │
    ├── 🚀 FLASK APP (User Interface)
    │   └── reinforcementTraining/
    │       │
    │       ├── app.py                      Main Flask application
    │       │   ├─ GET /                    Show input form
    │       │   ├─ POST /                   Generate 3 options
    │       │   ├─ POST /choose             Save user preference
    │       │   └─ POST /retrain            Trigger DPO training
    │       │
    │       ├── 🧠 MODEL CHECKPOINT (900MB)
    │       │   └── t5-small-detox-finetuned/
    │       │       ├── config.json         Model configuration
    │       │       ├── model.safetensors   Model weights (fp32)
    │       │       ├── tokenizer.json      Tokenizer vocab
    │       │       ├── tokenizer_config.json
    │       │       ├── special_tokens_map.json
    │       │       ├── generation_config.json
    │       │       └── checkpoint-*/       Training checkpoints
    │       │
    │       ├── 💾 USER DATA
    │       │   └── user_preferences.json   User preference history
    │       │       └─ Format: [{toxic, chosen, rejected}, ...]
    │       │
    │       ├── 🎨 FRONTEND
    │       │   ├── templates/
    │       │   │   └── index.html          Preference selection UI
    │       │   │       ├─ Input form (toxic text)
    │       │   │       ├─ 3 option buttons (clickable)
    │       │   │       ├─ Select & submit button
    │       │   │       ├─ Retrain button
    │       │   │       ├─ Status display
    │       │   │       └─ JavaScript handlers
    │       │   │
    │       │   └── static/
    │       │       └── style.css           CSS styling
    │       │
    │       └── logs/ (optional)
    │           └── training logs
    │
    └── 🔄 WORKFLOW DIAGRAM
        │
        Step 1: SUPERVISED TRAINING (4 hours)
        ├─ python init_train.py
        ├─ Trains on 19,743 pairs
        ├─ 20 epochs, FP16, 95/5 split
        └─ Outputs: t5-small-detox-finetuned/
        
        Step 2: FLASK APP (Ongoing)
        ├─ cd reinforcementTraining && python app.py
        ├─ Visit http://localhost:5000
        ├─ User generates 3 options
        ├─ User picks best (green highlight)
        └─ Preference saved to user_preferences.json
        
        Step 3: DPO RETRAINING (30 mins each)
        ├─ Collect 10-20 preferences
        ├─ Click "Retrain Model (DPO)" button (or python after_train.py)
        ├─ DPOTrainer learns user preferences
        ├─ Model improves
        └─ Back to Step 2 with better model
        
        Step 4: ITERATE
        └─ Repeat Steps 2-3 for continuous improvement
```

## Key File Purposes

### 📖 Documentation
- **START_HERE.md** - Main entry point, quick summary
- **QUICKSTART.md** - Step-by-step setup & usage guide
- **ARCHITECTURE.md** - System design, data flow diagrams
- **README_DPO.md** - Comprehensive pipeline documentation
- **IMPLEMENTATION_SUMMARY.md** - High-level system overview
- **CHANGES.md** - Before/after code comparison
- **CHECKLIST.md** - Verification & testing checklist

### 🤖 Core Training
- **init_train.py** - Initial supervised training (20 epochs)
- **after_train.py** - DPO fine-tuning on user preferences
- **requirements.txt** - All Python dependencies

### 🚀 Flask Application
- **app.py** - Main Flask server
  - Routes: `/`, `/choose`, `/retrain`
  - Functions: `generate_responses()`, `save_preference()`
  - Handles subprocess for DPO training

### 🎨 Frontend
- **index.html** - User interface for preference selection
  - 3 option buttons (select best)
  - JavaScript AJAX handlers
  - Real-time status updates
  - Retrain button & progress display
- **style.css** - Styling & layout

### 💾 Data & Models
- **user_preferences.json** - User feedback data
  - Format: `{toxic, chosen, rejected}`
  - Grows with each user interaction
  - Input for DPO training
- **t5-small-detox-finetuned/** - Model checkpoint
  - Trained by init_train.py
  - Updated by after_train.py
  - Used for inference in Flask app

### 📊 Training Data
- **paradetox.tsv** - Main training dataset (19,226 pairs)
- **paradetox_cannot_rewrite.tsv** - Edge cases (517 examples)

## How Files Interact

```
Data Files
│
├─ paradetox.tsv
├─ paradetox_cannot_rewrite.tsv
│
├─► init_train.py ─────────────────┐
│                                   │
│   (20 epochs supervised training) │
│                                   ▼
│                    t5-small-detox-finetuned/
│                    (base model: 900MB)
│                           │
│                           ├──► Flask app (app.py)
│                           │    ├─ Loads model
│                           │    ├─ Generates options
│                           │    ├─ Serves HTTP
│                           │    └─ Saves preferences
│                           │
│                           └──► after_train.py
│                                ├─ Loads preferences
│                                ├─ DPO training (2 epochs)
│                                └─ Updates model
│
└─ user_preferences.json
   └─► after_train.py
       └─► Updated model
           └─► Flask app uses improved model
```

## File Size Reference

| File | Size | Type |
|------|------|------|
| init_train.py | ~6 KB | Python script |
| after_train.py | ~4 KB | Python script |
| app.py | ~3 KB | Python script |
| index.html | ~9 KB | HTML template |
| model.safetensors | ~900 MB | Model weights |
| paradetox.tsv | ~150 MB | Training data |
| paradetox_cannot_rewrite.tsv | ~2 MB | Training data |
| user_preferences.json | ~1 KB per example | User data |

## Folder Organization

```
DetoxifierAI/
├── Training Scripts (in root)
│   ├── init_train.py
│   ├── after_train.py
│   └── requirements.txt
│
├── Training Data (in root)
│   ├── paradetox.tsv
│   └── paradetox_cannot_rewrite.tsv
│
├── Documentation (in root)
│   ├── START_HERE.md
│   ├── QUICKSTART.md
│   ├── ARCHITECTURE.md
│   ├── README_DPO.md
│   ├── IMPLEMENTATION_SUMMARY.md
│   ├── CHANGES.md
│   └── CHECKLIST.md
│
└── reinforcementTraining/ (Flask app folder)
    ├── app.py
    ├── t5-small-detox-finetuned/ (model)
    ├── user_preferences.json (data)
    ├── templates/
    │   └── index.html
    └── static/
        └── style.css
```

## Quick Navigation

**For quick start:** `START_HERE.md` → `QUICKSTART.md`  
**For system design:** `ARCHITECTURE.md`  
**For code changes:** `CHANGES.md`  
**For verification:** `CHECKLIST.md`  
**For full docs:** `README_DPO.md`

---

**Ready to begin?** Start with `START_HERE.md` 🚀
