# Read the file as text with utf-8 encoding, do replacements, write back
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Change .sheet-sync-club from display:none to inline-flex with styling (LF line endings)
old1 = '.sheet-sync-club { display: none; }\n@media (max-width: 760px) {\n  .sheet-sync-club {\n    display: inline-flex; /* this rule sits after the base display:none, so it wins inside the <=760px media query */\n    align-items: center; gap: 6px; flex-shrink: 0;\n    min-height: 32px; padding: 0 10px; border-radius: var(--radius-pill);\n    background: var(--input-bg); border:  1px solid var(--glass-border);\n    font-size: 11px; font-weight: 800; letter-spacing: 0.03em; color: var(--tm);\n    cursor: pointer; white-space: nowrap;\n  }\n  .sheet-sync-club:active { transform: scale(0.97); }\n}\n'
new1 = '.sheet-sync-club {\n  display: inline-flex;\n  align-items: center; gap: 6px; flex-shrink: 0;\n  min-height: 32px; padding: 0 10px; border-radius: var(--radius-pill);\n  background: var(--input-bg); border:  1px solid var(--glass-border);\n  font-size: 11px; font-weight: 800; letter-spacing: 0.03em; color: var(--tm);\n  cursor: pointer; white-space: nowrap;\n}\n.sheet-sync-club:active { transform: scale(0.97); }\n'
if old1 in content:
    content = content.replace(old1, new1, 1)
    print('1. Changed .sheet-sync-club to always-visible pill with styling')
else:
    print('1. FAILED: Could not find .sheet-sync-club block')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done.')