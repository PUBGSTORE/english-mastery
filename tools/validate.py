#!/usr/bin/env python3
"""Validate every JSON file under ./data against the schemas in PLAN.md.

Usage:  python3 tools/validate.py            # validate all
        python3 tools/validate.py data/vocab-a1.json
Exit code 1 on any error. Also prints counts, and checks ID uniqueness across files.
"""
import json, sys, os, re, glob

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'data')
CEFR = {'A1', 'A2', 'B1', 'B2', 'C1', 'C2'}
DEV = re.compile(r'[ऀ-ॿ]')
errors = []
seen_ids = {}

def err(f, msg):
    errors.append(f'{os.path.basename(f)}: {msg}')

def need(f, obj, keys, ctx):
    for k in keys:
        if k not in obj:
            err(f, f'{ctx}: missing "{k}"')

def has_hindi(s):
    return isinstance(s, str) and bool(DEV.search(s))

def uid(f, i):
    if i in seen_ids and seen_ids[i] != os.path.basename(f):
        err(f, f'duplicate id {i} (also in {seen_ids[i]})')
    seen_ids[i] = os.path.basename(f)

def v_vocab(f, arr, min_count):
    if not isinstance(arr, list): return err(f, 'must be array')
    if len(arr) < min_count: err(f, f'only {len(arr)} entries, need {min_count}')
    for e in arr:
        c = e.get('id', '?')
        uid(f, c)
        need(f, e, ['id','word','ipa','pos','cefr','en_def','hi_def','hi_nuance','examples','collocations','synonyms','antonyms','word_family','register','common_mistake','cloze','tags'], c)
        if e.get('cefr') not in CEFR: err(f, f'{c}: bad cefr {e.get("cefr")}')
        ex = e.get('examples', [])
        if len(ex) < 5: err(f, f'{c}: {len(ex)} examples, need 5+')
        for x in ex:
            if not x.get('en') or not has_hindi(x.get('hi','')): err(f, f'{c}: example missing en or Devanagari hi'); break
        if not has_hindi(e.get('hi_def','')): err(f, f'{c}: hi_def not Devanagari')
        cm = e.get('common_mistake') or {}
        if not (cm.get('wrong') and cm.get('right') and cm.get('why')): err(f, f'{c}: common_mistake incomplete')
        cl = e.get('cloze') or {}
        if '____' not in cl.get('sentence',''): err(f, f'{c}: cloze sentence needs ____')
        if not cl.get('answer'): err(f, f'{c}: cloze answer missing')
        if e.get('register') not in {'formal','neutral','informal','slang','technical'}: err(f, f'{c}: bad register {e.get("register")}')
        if not isinstance(e.get('word_family'), list) or len(e['word_family']) < 1: err(f, f'{c}: word_family empty')
        if 'TODO' in json.dumps(e) or 'placeholder' in json.dumps(e).lower(): err(f, f'{c}: placeholder text')

def v_collocations(f, arr):
    if len(arr) < 150: err(f, f'only {len(arr)} entries, need 150')
    for e in arr:
        c = e.get('id','?'); uid(f, c)
        need(f, e, ['id','phrase','pattern','cefr','en_def','hi_def','wrong','examples'], c)
        if len(e.get('examples',[])) < 2: err(f, f'{c}: need 2+ examples')
        if not has_hindi(e.get('hi_def','')): err(f, f'{c}: hi_def not Devanagari')

def v_grammar(f, arr):
    if len(arr) < 60: err(f, f'only {len(arr)} lessons, need 60')
    orders = set()
    for e in arr:
        c = e.get('id','?'); uid(f, c)
        need(f, e, ['id','order','cefr','title','concept_en','concept_hi','pattern','examples','contrast','practice','production','tags'], c)
        if e.get('order') in orders: err(f, f'{c}: duplicate order {e.get("order")}')
        orders.add(e.get('order'))
        if len(e.get('examples',[])) < 8: err(f, f'{c}: {len(e.get("examples",[]))} examples, need 8+')
        for x in e.get('examples',[]):
            if not has_hindi(x.get('hi','')): err(f, f'{c}: example without Devanagari'); break
        if len(e.get('contrast',[])) < 3: err(f, f'{c}: need 3+ contrast items')
        for x in e.get('contrast',[]):
            need(f, x, ['wrong','right','why_en','why_hi'], f'{c} contrast')
        pr = e.get('practice',[])
        if len(pr) < 10: err(f, f'{c}: {len(pr)} practice items, need 10')
        for p in pr:
            uid(f, p.get('id','?'))
            need(f, p, ['id','type','prompt','answer','feedback_en'], f'{c} practice')
            if p.get('type') not in {'fill','choose','fix','reorder','tf'}: err(f, f'{c}: bad practice type {p.get("type")}')
            if p.get('type') == 'choose' and not p.get('options'): err(f, f'{p.get("id")}: choose needs options')
            if p.get('type') == 'reorder' and not p.get('words'): err(f, f'{p.get("id")}: reorder needs words')
            if not isinstance(p.get('answer'), list) or not p['answer']: err(f, f'{p.get("id")}: answer must be non-empty list')
            if p.get('type') == 'fill' and '___' not in p.get('prompt',''): err(f, f'{p.get("id")}: fill prompt needs ___')
        if not has_hindi(e.get('concept_hi','')): err(f, f'{c}: concept_hi not Devanagari')
        if not (e.get('production') or {}).get('task_en'): err(f, f'{c}: production.task_en missing')

def v_phonemes(f, arr):
    if len(arr) != 44: err(f, f'{len(arr)} phonemes, need exactly 44')
    for e in arr:
        c = e.get('id','?'); uid(f, c)
        need(f, e, ['id','ipa','type','label','mouth_en','mouth_hi','hindi_trap','examples','contrast_with'], c)
        if len(e.get('examples',[])) < 5: err(f, f'{c}: need 5 examples')
        if not has_hindi(e.get('mouth_hi','')): err(f, f'{c}: mouth_hi not Devanagari')

def v_pairs(f, arr):
    if len(arr) < 120: err(f, f'only {len(arr)} pairs, need 120')
    for e in arr:
        c = e.get('id','?'); uid(f, c)
        need(f, e, ['id','contrast','contrast_label','phonemes','a','b','sentence_a','sentence_b','tip_en','tip_hi','difficulty'], c)
        for s in ('a','b'):
            if not (e.get(s) or {}).get('word') or not (e.get(s) or {}).get('ipa'): err(f, f'{c}: {s} needs word+ipa')

def v_stress(f, obj):
    need(f, obj, ['word_stress','sentence_stress','reductions','connected','intonation'], 'root')
    mins = {'word_stress':120,'sentence_stress':60,'reductions':40,'connected':60,'intonation':50}
    for k, m in mins.items():
        arr = obj.get(k, [])
        if len(arr) < m: err(f, f'{k}: {len(arr)} items, need {m}')
        for e in arr:
            uid(f, e.get('id','?'))
    for e in obj.get('word_stress',[]):
        if not isinstance(e.get('stressed'), int) or e['stressed'] >= len(e.get('syllables',[])): err(f, f'{e.get("id")}: bad stressed index')
    for e in obj.get('sentence_stress',[]):
        n = len(e.get('sentence','').split())
        if any(i >= n for i in e.get('content',[])): err(f, f'{e.get("id")}: content index out of range')
        if not has_hindi(e.get('hi','')): err(f, f'{e.get("id")}: hi missing')
    for e in obj.get('intonation',[]):
        n = len(e.get('sentence','').split())
        if len(e.get('contour',[])) != n: err(f, f'{e.get("id")}: contour length {len(e.get("contour",[]))} != words {n}')

def v_twisters(f, arr):
    if len(arr) < 30: err(f, f'only {len(arr)}, need 30')
    for e in arr:
        uid(f, e.get('id','?')); need(f, e, ['id','text','focus','difficulty','hi'], e.get('id','?'))

def v_shadowing(f, arr):
    if len(arr) < 80: err(f, f'only {len(arr)}, need 80')
    for e in arr:
        c = e.get('id','?'); uid(f, c)
        need(f, e, ['id','cefr','text','hi','focus','target_wps','words'], c)
        if len(e.get('target_wps',[])) != 2: err(f, f'{c}: target_wps needs [min,max]')
        if not has_hindi(e.get('hi','')): err(f, f'{c}: hi not Devanagari')

def v_listening(f, obj):
    need(f, obj, ['dictation','numbers','dates','spelling'], 'root')
    if len(obj.get('dictation',[])) < 150: err(f, f'dictation {len(obj.get("dictation",[]))}, need 150')
    for k in ('numbers','dates','spelling'):
        if len(obj.get(k,[])) < 30: err(f, f'{k} {len(obj.get(k,[]))}, need 30')
    for e in obj.get('dictation',[]):
        uid(f, e.get('id','?')); need(f, e, ['id','cefr','text','hi','trap'], e.get('id','?'))
    for k in ('numbers','dates','spelling'):
        for e in obj.get(k,[]):
            uid(f, e.get('id','?')); need(f, e, ['id','spoken','answer'], e.get('id','?'))

def v_writing(f, obj):
    need(f, obj, ['templates','prompts'], 'root')
    if len(obj.get('templates',[])) < 5: err(f, 'need 5+ templates')
    if len(obj.get('prompts',[])) < 30: err(f, f'prompts {len(obj.get("prompts",[]))}, need 30')
    tids = {t.get('id') for t in obj.get('templates',[])}
    for t in obj.get('templates',[]):
        uid(f, t.get('id','?')); need(f, t, ['id','name','skeleton','register','tips_en','tips_hi'], t.get('id','?'))
    for p in obj.get('prompts',[]):
        uid(f, p.get('id','?')); need(f, p, ['id','template','cefr','task_en','task_hi','min_words'], p.get('id','?'))
        if p.get('template') not in tids: err(f, f'{p.get("id")}: unknown template {p.get("template")}')

def v_speaking(f, arr):
    if len(arr) < 90: err(f, f'only {len(arr)}, need 90')
    for e in arr:
        uid(f, e.get('id','?')); need(f, e, ['id','cefr','prompt_en','prompt_hi','seconds','target_vocab'], e.get('id','?'))

def v_placement(f, arr):
    if len(arr) < 60: err(f, f'only {len(arr)}, need 60')
    by = {}
    for e in arr:
        uid(f, e.get('id','?')); need(f, e, ['id','cefr','skill','type','prompt','options','answer'], e.get('id','?'))
        if not isinstance(e.get('answer'), int) or e['answer'] >= len(e.get('options',[])): err(f, f'{e.get("id")}: answer must be index into options')
        by[e.get('cefr')] = by.get(e.get('cefr'),0)+1
    for lvl in ('A1','A2','B1','B2','C1'):
        if by.get(lvl,0) < 10: err(f, f'need 10+ items at {lvl}, have {by.get(lvl,0)}')

def v_simple(f, arr, min_count, keys, hi_keys=()):
    if not isinstance(arr, list): return err(f, 'must be array')
    if len(arr) < min_count: err(f, f'only {len(arr)}, need {min_count}')
    for e in arr:
        uid(f, e.get('id','?')); need(f, e, keys, e.get('id','?'))
        for k in hi_keys:
            if not has_hindi(e.get(k,'')): err(f, f'{e.get("id")}: {k} not Devanagari')

def v_chunks(f, arr):
    v_simple(f, arr, 300, ['id','function','chunk','hi','register','examples','clumsy','note_en','note_hi'], ['hi','note_hi'])
    funcs = {e.get('function') for e in arr}
    if len(funcs) < 12: err(f, f'only {len(funcs)} functions, need 12+')
    for e in arr:
        if len(e.get('examples',[])) != 3: err(f, f'{e.get("id")}: need exactly 3 examples')

def v_morphology(f, arr):
    v_simple(f, arr, 120, ['id','part','type','origin','meaning_en','meaning_hi','derived','decode','note_en','note_hi'], ['meaning_hi','note_hi'])
    for e in arr:
        if not (6 <= len(e.get('derived',[])) <= 8): err(f, f'{e.get("id")}: derived must have 6-8 items')
        if len(e.get('decode',[])) < 2: err(f, f'{e.get("id")}: need 2 decode items')

def v_confusables(f, arr):
    v_simple(f, arr, 100, ['id','a','b','rule_en','rule_hi','examples','quiz','trap_en'], ['rule_hi'])
    for e in arr:
        if len(e.get('quiz',[])) != 3 or any('___' not in q.get('sentence','') for q in e.get('quiz',[])): err(f, f'{e.get("id")}: quiz needs 3 items with ___')

def v_phrases(f, arr):
    v_simple(f, arr, 200, ['id','phrase','hi','when_en','when_hi','register','stiff','examples','topic'], ['hi','when_hi'])

def v_scenarios(f, arr):
    v_simple(f, arr, 10, ['id','title','role_ai','role_me','opening','goals','vocab','turns','hi'], ['hi'])

def v_frequency(f, arr):
    if len(arr) != 5000: err(f, f'{len(arr)} lemmas, need exactly 5000')
    seen=set()
    for i,e in enumerate(arr):
        if e.get('r') != i+1: err(f, f'rank mismatch at {i}'); break
        if e['l'] in seen: err(f, f'duplicate lemma {e["l"]}')
        seen.add(e['l'])
        if e.get('b') != i//1000+1: err(f, f'band mismatch at {i}'); break

def v_irregular(f, arr):
    forms=[e.get('form') for e in arr]
    if len(forms) != len(set(forms)): err(f, 'duplicate forms')
    if len(arr) < 200: err(f, f'only {len(arr)} forms, need 200+')

def v_tenses(f, arr):
    v_simple(f, arr, 12, ['id','name','time','aspect','form','use_en','use_hi','signals','examples','hindi_trap'], ['use_hi'])

def v_indianisms(f, arr):
    if len(arr) < 40: err(f, f'only {len(arr)}, need 40')
    for e in arr:
        uid(f, e.get('id','?')); need(f, e, ['id','indian','natural','why_en','why_hi','example_wrong','example_right'], e.get('id','?'))

VALIDATORS = {
    'vocab-a1.json': lambda f,d: v_vocab(f,d,200), 'vocab-a2.json': lambda f,d: v_vocab(f,d,200),
    'vocab-b1.json': lambda f,d: v_vocab(f,d,200), 'vocab-b2.json': lambda f,d: v_vocab(f,d,200),
    'vocab-c1.json': lambda f,d: v_vocab(f,d,150), 'vocab-tech.json': lambda f,d: v_vocab(f,d,150),
    'phrasal-verbs.json': lambda f,d: v_vocab(f,d,80), 'idioms.json': lambda f,d: v_vocab(f,d,60),
    'collocations.json': v_collocations, 'grammar.json': v_grammar, 'indianisms.json': v_indianisms,
    'phonemes.json': v_phonemes, 'minimal-pairs.json': v_pairs, 'stress.json': v_stress,
    'tongue-twisters.json': v_twisters, 'shadowing.json': v_shadowing, 'listening.json': v_listening,
    'writing-prompts.json': v_writing, 'speaking-prompts.json': v_speaking, 'placement.json': v_placement,
    'vocab-everyday.json': lambda f,d: v_vocab(f,d,600), 'chunks.json': v_chunks, 'morphology.json': v_morphology, 'confusables.json': v_confusables,
    'daily-phrases.json': v_phrases, 'scenarios.json': v_scenarios, 'frequency-5000.json': v_frequency, 'irregular-verbs.json': v_irregular,
    'tenses.json': v_tenses, 'stoplist.json': lambda f,d: None if isinstance(d, list) and len(d) >= 200 else err(f, 'stoplist too short'),
    'channels.json': lambda f,d: None if isinstance(d, list) and len(d) >= 8 else err(f, 'channels too short'),
}

def main():
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(DATA, '*.json')))
    for f in files:
        name = os.path.basename(f)
        if name == 'index.json': continue
        try:
            with open(f, encoding='utf-8') as fh: d = json.load(fh)
        except Exception as e:
            err(f, f'invalid JSON: {e}'); continue
        v = VALIDATORS.get(name)
        if not v: print(f'  (no validator for {name})'); continue
        v(f, d)
        n = len(d) if isinstance(d, list) else sum(len(x) for x in d.values() if isinstance(x, list))
        print(f'  {name}: {n} items')
    if errors:
        print(f'\n{len(errors)} error(s):')
        for e in errors[:200]: print('  ' + e)
        sys.exit(1)
    print('\nOK: all files valid')

if __name__ == '__main__':
    main()
