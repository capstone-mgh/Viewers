#!/usr/bin/python
#python 2.7

#fix css link
import os
import sys

LINK_START = '        <link rel="stylesheet" type="text/css" class="__meteor-css__" href="/'
LINK_END = '?meteor_css_resource=true">\n'

if len(sys.argv) < 2:
    raise ValueError("Directory not specified")

directory = sys.argv[1]
css_files = [f for f in os.listdir(directory) if f.endswith("css")]

index_orig = os.path.join(directory, "index.html")
index_temp = os.path.join(directory, "indextemp.html")

with open(index_orig, "r") as filein, open(index_temp, "w") as fileout:
    for line in filein:
        fileout.write(line)
        if line.startswith(LINK_START):
            existing_css = line[len(LINK_START):-len(LINK_END)]
            for css_file in css_files:
                if css_file != existing_css:
                    fileout.write(LINK_START + css_file + LINK_END)

os.rename(index_temp, index_orig)