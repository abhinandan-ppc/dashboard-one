with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the now-duplicate media query for .sheet-sync-club
old = '@media (max-width: 760px) {\n  .sheet-sync-club {\n    display: inline-flex; /* this rule sits after the base display:none, so it wins inside the <=760px media query */\n    align-items: center; gap: 6px; flex-shrink: 0;\n    min-height: 32px; padding: 0 10px; border-radius: var(--radius-pill);\n    background: var(--input-bg); border:  1px solid var(--glass-border);\n    font-size: 11px; font-weight: 800; letter-spacing: 0.03em; color: var(--tm);\n    cursor: pointer; white-space: nowrap;\n  }\n  .sheet-sync-club:active { transform: scale(0.97); }\n}\n'
if old in content:
    content = content.replace(old, '', 1)
    print('Removed duplicate media query for .sheet-sync-club')
else:
    print('FAILED: Could not find media query block')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done.')