"""Runs on Kaggle (free T4 GPU, private notebook): fine-tune a small open model to write video insights the way
the cloud AI does, test it on held-out videos, export a GGUF file for CPU use. Pushed by .github/workflows/analyst.yml.
Inputs: /kaggle/input/pulse-analyst-data/{train,test}.jsonl. Outputs (in /kaggle/working): pulse-analyst.gguf,
metrics.json, samples.json."""
import glob
import json
import os
import re
import subprocess
import sys
import time

t0 = time.time()


def _online(host="pypi.org"):
    import socket
    try:
        socket.create_connection((host, 443), timeout=10).close()
        return True
    except OSError:
        return False


# Kaggle gives notebooks internet and GPUs only on phone-verified accounts. Say so plainly instead of failing later.
_gpu = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True).returncode == 0
if not _online() or not _gpu:
    print(f"NEEDS_PHONE_VERIFICATION internet={_online()} gpu={_gpu}: verify the phone number at "
          "kaggle.com -> Settings -> Phone verification (free), then the next run trains by itself.", flush=True)
    sys.exit(3)
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "unsloth"], check=True)

from unsloth import FastLanguageModel  # noqa: E402  (unsloth first, so it can patch the others)
import torch  # noqa: E402
from datasets import Dataset  # noqa: E402
from trl import SFTConfig, SFTTrainer  # noqa: E402

BASE = os.environ.get("ANALYST_BASE", "unsloth/Qwen2.5-1.5B-Instruct")
MAX_LEN = 4096
# Kaggle mounts datasets at /kaggle/input/<slug> or, newer, /kaggle/input/datasets/<owner>/<slug>: search all of it.
_found = sorted(glob.glob("/kaggle/input/**/train.jsonl", recursive=True))
if not _found:
    print("NO_TRAINING_DATA: nothing named train.jsonl under /kaggle/input:", flush=True)
    for root, _dirs, files in os.walk("/kaggle/input"):
        print(" ", root, files[:10], flush=True)
    sys.exit(4)
data_dir = os.path.dirname(_found[0])
rows = lambda f: [json.loads(x) for x in open(os.path.join(data_dir, f)) if x.strip()]  # noqa: E731
train, test = rows("train.jsonl"), rows("test.jsonl")
print(f"train {len(train)} test {len(test)} gpu {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none'}", flush=True)

model, tok = FastLanguageModel.from_pretrained(BASE, max_seq_length=MAX_LEN, load_in_4bit=True)
model = FastLanguageModel.get_peft_model(model, r=16, lora_alpha=32, lora_dropout=0, target_modules=[
    "q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"], use_gradient_checkpointing="unsloth", random_state=7)


def chat(r, with_answer=True):
    msgs = [{"role": "system", "content": r["system"]}, {"role": "user", "content": r["prompt"]}]
    if with_answer:
        msgs.append({"role": "assistant", "content": r["response"]})
    return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=not with_answer)


ds = Dataset.from_list([{"text": chat(r)} for r in train])
trainer = SFTTrainer(model=model, tokenizer=tok, train_dataset=ds, args=SFTConfig(
    dataset_text_field="text", max_seq_length=MAX_LEN, per_device_train_batch_size=1, gradient_accumulation_steps=8,
    num_train_epochs=float(os.environ.get("ANALYST_EPOCHS", "2")), learning_rate=2e-4, warmup_ratio=0.05, logging_steps=5,
    lr_scheduler_type="cosine", optim="adamw_8bit", fp16=not torch.cuda.is_bf16_supported(), bf16=torch.cuda.is_bf16_supported(),
    output_dir="/kaggle/working/ckpt", report_to=[], seed=7))
print(f"stage setup {(time.time() - t0) / 60:.1f} min", flush=True)
stats = trainer.train()
print(f"trained in {(time.time() - t0) / 60:.0f} min, loss {stats.training_loss:.3f}", flush=True)
print(f"stage trained {(time.time() - t0) / 60:.1f} min", flush=True)

# ---- test on held-out videos against the cloud AI's own answers
FastLanguageModel.for_inference(model)
KEYS = ["summary", "mood", "liked", "complaints", "requests", "questions", "topics", "language_notes"]
words = lambda s: set(re.findall(r"[a-z]{3,}", s.lower()))  # noqa: E731
results, valid, keys_ok, overlap = [], 0, 0.0, 0.0
for r in test[: int(os.environ.get("ANALYST_TEST_N", "25"))]:
    ids = tok(chat(r, with_answer=False), return_tensors="pt").to("cuda")
    out = model.generate(**ids, max_new_tokens=900, do_sample=False, temperature=None, top_p=None)
    text = tok.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True).strip()
    m = re.search(r"\{.*\}", text, re.S)
    try:
        got = json.loads(m.group(0)) if m else None
    except ValueError:
        got = None
    want = json.loads(r["response"])
    if isinstance(got, dict):
        valid += 1
        keys_ok += sum(k in got for k in KEYS) / len(KEYS)
        a, b = words(str(got.get("summary", ""))), words(str(want.get("summary", "")))
        overlap += len(a & b) / max(1, len(a | b))
    results.append({"want": want.get("summary"), "got": (got or {}).get("summary") if isinstance(got, dict) else text[:400]})
n = max(1, len(results))
metrics = {"base_model": BASE, "train_pairs": len(train), "test_pairs": len(results), "train_loss": round(stats.training_loss, 4),
           "valid_json": round(valid / n, 3), "fields_present": round(keys_ok / max(1, valid), 3),
           "summary_word_overlap": round(overlap / max(1, valid), 3), "minutes": round((time.time() - t0) / 60, 1),
           "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
print(f"stage tested {(time.time() - t0) / 60:.1f} min", flush=True)
print(json.dumps(metrics), flush=True)
json.dump(metrics, open("/kaggle/working/metrics.json", "w"), indent=2)
json.dump(results[:12], open("/kaggle/working/samples.json", "w"), ensure_ascii=False, indent=2)

# ---- export: 4-bit GGUF that runs on a CPU with llama.cpp
model.save_pretrained_gguf("/kaggle/working/gguf", tok, quantization_method="q4_k_m")
g = sorted(glob.glob("/kaggle/working/gguf*/*.gguf") + glob.glob("/kaggle/working/*.gguf"), key=os.path.getsize)[-1]
os.replace(g, "/kaggle/working/pulse-analyst.gguf")
subprocess.run("rm -rf /kaggle/working/ckpt /kaggle/working/gguf* /kaggle/working/unsloth_compiled_cache", shell=True)
print("done", round((time.time() - t0) / 60, 1), "min", flush=True)
