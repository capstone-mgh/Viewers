#!/bin/bash
OUTPUTFOLDER="ohif"
cd StandaloneViewer
METEOR_PACKAGE_DIRS="../../Packages" meteor-build-client ../$OUTPUTFOLDER -u sakeviewer.com
cd ..

python fixcsslink.py $OUTPUTFOLDER
