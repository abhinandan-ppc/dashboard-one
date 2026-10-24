with open("index.html","r",encoding="utf-8") as f: c=f.read()

# Check skeleton loading indicator
skeleton = c.find("skeleton skeleton-block")
print("Skeleton found at:", skeleton)

# Check the frame-stage div
fs = c.find("frame-stage")
print("frame-stage at:", fs)

# Check the full area around pageFrame
idx = c.find("pageFrame")
print("pageFrame at:", idx)
if idx >= 0:
    print("Around pageFrame (200 chars):")
    print(c[max(0,idx-50):idx+150])

# Check for any initialization script  
# Look for patterns like "pageFrame.src" or similar
for pattern in ["pageFrame.src", "pageFrame.setAttribute", "frame.src", "src.*pageFrame"]:
    idx2 = c.find(pattern)
    print(f"'{pattern}': {idx2 if idx2 >= 0 else 'NOT FOUND'}")