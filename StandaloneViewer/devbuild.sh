#!/bin/bash
OUTPUTFOLDER="myOutputFolder"
cd StandaloneViewer
METEOR_PACKAGE_DIRS="../../Packages" meteor-build-client ../$OUTPUTFOLDER -u localhost:3000
cd ..

python fixcsslink.py $OUTPUTFOLDER
cp -r devsampledata/* $OUTPUTFOLDER