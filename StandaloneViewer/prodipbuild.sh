#!/bin/bash
OUTPUTFOLDER="ohif3"
cd StandaloneViewer
METEOR_PACKAGE_DIRS="../../Packages" meteor-build-client ../$OUTPUTFOLDER -u "104.198.43.42"
cd ..

python fixcsslink.py $OUTPUTFOLDER