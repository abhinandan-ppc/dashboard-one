with open("index.html","r",encoding="utf-8") as f: c=f.read()

hdr_r_start = c.find("<div class=\"hdr-r\">")
hdr_r_end = c.find("</div>", hdr_r_start)
pill_pos = c.find('class="sheet-sync-club"')
home_btn_pos = c.find('id="homeBtn"')

print("hdr-r starts at:", hdr_r_start)
print("hdr-r ends at:", hdr_r_end)
print("pill element at:", pill_pos)
print("home button at:", home_btn_pos)
print()

# Find the full pill element - from <button to </button>
btn_start = c.find("<button", pill_pos)
btn_end = c.find("</button>", pill_pos) + 9  # include </button> and trailing space/newline
pill_element = c[btn_start:btn_end]
print("Full pill element HTML:")
print(pill_element)
print()

# Find where to insert the pill - just before hdr-r closing tag
# The hdr-r content currently has the 4 chips, then we want to add the pill before </div>

# Check what's between the inner sheet-sync div closing and hdr-r closing
inner_sheet_end = c.find("</div>", hdr_r_start + 30)  # after sheet-sync opening
print("Inner sheet-sync </div> at:", inner_sheet_end)
print("Content between inner div and hdr-r closing:")
print(c[inner_sheet_end:hdr_r_end])
print()

# The pill is currently after hdr-r
print("Pill position relative to hdr-r end:", pill_pos - hdr_r_end, "chars after")