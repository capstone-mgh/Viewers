import { OHIF } from 'meteor/ohif:core';
import { Viewerbase } from 'meteor/ohif:viewerbase';

(function($, cornerstone, cornerstoneMath, cornerstoneTools) {

    'use strict';

    var toolType = 'sake';
    //select segmentation source
    //var getSegmentation = getSegmentationBackend;
    var getSegmentation = getSegmentationFrontend;
    var drawMask = false;

    //get segmentation from backend
    function getSegmentationBackend(element, measurementData) {
        if (measurementData.segmentationPending) {
            return; //REST request in progress
        }

        //TODO remove hard coded url
        var url = 'http://104.198.43.42/sake/segment';
        measurementData.segmentationPending = true;

        console.log('GET request parameters');
        console.log(measurementData.requestData);

        $.ajax({
          url: url,
          data: measurementData.requestData
        }).done(function(data) {
            console.log('ajax get request returned');
            measurementData.segmentation = JSON.parse(data);
            processSegmentation(element, measurementData);
        }).fail(function() {
            console.log('ajax get request failed, defaulting to front-end segmentation');
            getSegmentationFrontend(element, measurementData);
        });
    }

    //compute segmentation on frontend
    function getSegmentationFrontend(element, measurementData) {
        var image, segmentation, polygon;
        image = cornerstone.getEnabledElement(element).image;
        measurementData.segmentationPending = true;
        segmentation = segment(image, measurementData.requestData.x, measurementData.requestData.y, measurementData.requestData.threshold);
        if (segmentation.area < 1000) {
            polygon = getContourPolygon(segmentation.mask);
            measurementData.segmentation = {
                "mask": segmentation.mask,
                "maskOffset": [0, 0],
                "polygon": polygon
            };
        } else {
            measurementData.segmentation = {};
        }
        processSegmentation(element, measurementData);
    }

    //process segmentation result
    function processSegmentation(element, measurementData) {
        var polygon = measurementData.segmentation.polygon;
        if (polygon && polygon.length) {
            var xCenter = 0,
                yCenter = 0,
                z = measurementData.requestData.z,
                xOrig = measurementData.requestData.xOrig,
                yOrig = measurementData.requestData.yOrig,
                zOrig = measurementData.requestData.zOrig,
                propagationDirection = Math.sign(z - zOrig);
            //compute center
            for (var i = 0; i < polygon.length; i++) {
                xCenter += polygon[i][0];
                yCenter += polygon[i][1];
            }
            xCenter = Math.round(xCenter / polygon.length);
            yCenter = Math.round(yCenter / polygon.length);
            //propagate to next slice
            if (propagationDirection >= 0) {
                createNewMeasurementInternal(element, xCenter, yCenter, z + 1, xOrig, yOrig, zOrig);
            }
            if (propagationDirection <= 0) {
                createNewMeasurementInternal(element, xCenter, yCenter, z - 1, xOrig, yOrig, zOrig);
            }
            //create handles from polygons
            for (var i = 0; i < polygon.length; i++) {
                measurementData.handles[i] = {
                    x: polygon[i][0],
                    y: polygon[i][1],
                    highlight: true,
                    active: false
                }
            }
            //update image
            measurementData.segmentationPending = false;
            cornerstone.updateImage(element);
        }
    }

    function createNewMeasurementInternal(element, x, y, z, xOrig, yOrig, zOrig) {
        var imageIds = cornerstoneTools.getToolState(element, 'stack').data[0].imageIds;
        if (z < 0 || z >= imageIds.length) {
            return; //out of stack range
        }
        var currentImageId = imageIds[z];
        //TODO handle missing metadata?
        var imageMetadata = OHIF.viewer.metadataProvider.getMetadata(currentImageId);
        var viewport = cornerstone.getViewport(element);

        var measurementData = {
            visible: false,
            active: true,
            handles: {
                control: {
                    x: x,
                    y: y,
                    highlight: true,
                    active: false
                }
            },
            controlPoint: {
                x: x,
                y: y
            },
            requestData: {
                x: x,
                y: y,
                z: z,
                xOrig: xOrig,
                yOrig: yOrig,
                zOrig: zOrig,
                threshold: 0.1,
                patientName: imageMetadata.patient.name,
                windowWidth: viewport.voi.windowWidth,
                windowCenter: viewport.voi.windowCenter,
                seriesInstanceUid: imageMetadata.series.seriesInstanceUid,
                sopInstanceUid: imageMetadata.instance.sopInstanceUid
            }
        };

        // associate this data with this imageId so we can render it and manipulate it
        cornerstoneTools.addToolState(element, toolType, measurementData, currentImageId);
        $(element).on('CornerstoneToolsMeasurementModified', dragCallback);
        return measurementData;
    }

    //distance squared of 2 points as [x, y] arrays
    function dist2(point1, point2) {
        var dx = point1[0] - point2[0],
            dy = point1[1] - point2[1];
        return dx * dx + dy * dy;
    }

    //propagate dragging a boundary point with exponential decay
    function propagateDrag(polygon, index, dx, dy, direction) {
        var index0, index1, index2, decay;
        decay = 1;
        index0 = index;
        index1 = (index0 + direction + polygon.length) % polygon.length;
        index2 = (index1 + direction + polygon.length) % polygon.length;
        while (decay > 0.25 && (dist2(polygon[index0], polygon[index1]) > dist2(polygon[index1], polygon[index2]))) {
            //taper off effect
            decay *= 0.85;
            //update point
            polygon[index1][0] += decay * dx;
            polygon[index1][1] += decay * dy;
            //continue propagating
            index0 = index1;
            index1 = index2;
            index2 = (index1 + direction + polygon.length) % polygon.length;
        }
    }

    //callback for dragging a handle
    function dragCallback(e, eventData) {
        var i, dx, dy, polygon, controlPoint, handles, changedIndex;

        if (eventData.toolType !== toolType || !eventData.measurementData.segmentation) {
            return;
        }

        handles = eventData.measurementData.handles;
        controlPoint = eventData.measurementData.controlPoint;

        //process control handle movement
        if ((handles.control.x !== controlPoint.x) || (handles.control.y !== controlPoint.y)) {
            dx = handles.control.x - controlPoint.x;
            dy = handles.control.y - controlPoint.y;

            if (Math.abs(dy) > Math.abs(dx)) { //vertical drag
                if (dy > 0) {
                    console.log("shrink");
                    eventData.measurementData.requestData.threshold /= 1.1;
                    eventData.measurementData.segmentation = false;
                } else {
                    console.log("grow");
                    eventData.measurementData.requestData.threshold *= 1.1;
                    eventData.measurementData.segmentation = false;
                }
            }

            //console.log("delete");
            //cornerstoneTools.removeToolState(eventData.element, toolType, eventData.measurementData);

            handles.control.x = controlPoint.x;
            handles.control.y = controlPoint.y;
            return;
        }

        polygon = eventData.measurementData.segmentation.polygon;
        changedIndex = -1;
        //find changed handle
        for (i = 0; i < polygon.length; i++) {
            if ((polygon[i][0] !== handles[i].x) || (polygon[i][1] != handles[i].y)) {
                changedIndex = i;
                break;
            }
        }
        if (changedIndex >= 0) {
            //update changed point and nearby points on polygon
            dx = handles[i].x - polygon[i][0];
            dy = handles[i].y - polygon[i][1];
            polygon[i][0] = handles[i].x;
            polygon[i][1] = handles[i].y;
            propagateDrag(polygon, i, dx, dy, 1);
            propagateDrag(polygon, i, dx, dy, -1);

            //copy polygon back to handles
            for (var i = 0; i < polygon.length; i++) {
                handles[i].x = polygon[i][0];
                handles[i].y = polygon[i][1];
            }
        }
    }

    //find point on edge of segment
    function getEdgePoint(mask) {
        for (i = 0; i < mask.length; i++) {
            for (j = 0; j < mask[0].length; j++) {
                if (mask[i][j]) {
                    return [i, j];
                }
            }
        }
    }

    //find boundary of segment
    //mask follows y,x (row,column) convention, polygon follows x,y convention
    function getContourPolygon(mask) {
        var i, j, start, polygon, directions, d, iDir, iDirLast, dir, vertexCount;
        vertexCount = 0;
        polygon = [];
        directions = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
        iDirLast = 0;
        start = getEdgePoint(mask);
        i = start[0];
        j = start[1];
        polygon.push([j, i]); //note: inverting y,x mask to x,y polygon
        //traverse edge of polygon
        do {
            //find next edge
            for (d = 0; d < 8; d++) {
                iDir = (d + iDirLast + 5) % 8;
                dir = directions[iDir];
                if (mask[i + dir[0]] && mask[i + dir[0]][j + dir[1]]) {
                    i += dir[0];
                    j += dir[1];
                    polygon.push([j, i]); //note: inverting y,x mask to x,y polygon
                    iDirLast = iDir;
                    break;
                }
            }
        } while ((i !== start[0] || j !== start[1]) && ++vertexCount < 10000)
        return polygon;
    }

    //segment
    function segment(image, x, y, threshold) {
        var pixels, mask, tMin, tMax, i, j, area;
        pixels = image.getPixelData();
        tMin = pixels[y * image.columns + x] - threshold * image.maxPixelValue;
        tMax = pixels[y * image.columns + x] + threshold * image.maxPixelValue;
        console.log("threshold");
        console.log(tMin);
        console.log(tMax);
        mask = []; //TODO convert to typed arrays?
        for (i = 0; i < image.rows; i++) {
            mask[i] = [];
            for (j = 0; j < image.columns; j++) {
                mask[i][j] = false;
            }
        }

        var stack = [], current, i, j, pixel;
        mask[y][x] = true;
        stack.push([y, x]);
        area = 1;
        while (stack.length) {
            current = stack.pop();
            i = current[0];
            j = current[1];
            if (i < image.columns - 1 && !mask[i+1][j]) {
                pixel = pixels[(i + 1) * image.columns + j];
                if (pixel > tMin && pixel < tMax) {
                    mask[i+1][j] = true;
                    stack.push([i+1, j]);
                    area++;
                }
            }
            if (i > 0 && !mask[i-1][j]) {
                pixel = pixels[(i - 1) * image.columns + j];
                if (pixel > tMin && pixel < tMax) {
                    mask[i-1][j] = true;
                    stack.push([i-1, j]);
                    area++;
                }
            }
            if (j < image.rows - 1 && !mask[i][j+1]) {
                pixel = pixels[i * image.columns + j + 1];
                if (pixel > tMin && pixel < tMax) {
                    mask[i][j+1] = true;
                    stack.push([i, j+1]);
                    area++;
                }
            }
            if (j > 0 && !mask[i][j-1]) {
                pixel = pixels[i * image.columns + j - 1];
                if (pixel > tMin && pixel < tMax) {
                    mask[i][j-1] = true;
                    stack.push([i, j-1]);
                    area++;
                }
            }
        }

        console.log("area");
        console.log(area);

        return {"mask": mask, "area": area};
    }

    ///////// BEGIN ACTIVE TOOL ///////
    function addNewMeasurement(mouseEventData) {
        var measurementData = createNewMeasurement(mouseEventData);
        if (!measurementData) {
            return;
        }

        cornerstone.updateImage(mouseEventData.element);
    }

    function createNewMeasurement(mouseEventData) {
        //create the measurement data for this tool with the end handle activated
        var x = Math.round(mouseEventData.currentPoints.image.x);
        var y = Math.round(mouseEventData.currentPoints.image.y);

        var stackData = cornerstoneTools.getToolState(mouseEventData.element, 'stack');
        if (!stackData || !stackData.data || !stackData.data.length) {
            console.log('no stack data available');
            return;
        }
        var z = stackData.data[0].currentImageIdIndex;

        return createNewMeasurementInternal(mouseEventData.element, x, y, z, x, y, z);
    }
    ///////// END ACTIVE TOOL ///////

    function pointNearTool(element, data, coords) {
        var distanceToPoint = cornerstoneMath.point.distance(data.handles.control, coords);
        return (distanceToPoint < 25);
    }

    ///////// BEGIN IMAGE RENDERING ///////
    function onImageRendered(e, eventData) {

        // if we have no toolData for this element, return immediately as there is nothing to do
        var toolData = cornerstoneTools.getToolState(e.currentTarget, toolType);
        if (!toolData) {
            return;
        }

        // we have tool data for this element - iterate over each one and draw it
        var canvas = eventData.canvasContext.canvas;
        var canvasWidth = canvas.width;
        var canvasHeight = canvas.height;
        var context = canvas.getContext('2d');

        //var context = eventData.canvasContext.canvas.getContext('2d');
        context.setTransform(1, 0, 0, 1, 0, 0);

        for (var i = 0; i < toolData.data.length; i++) {
            context.save();

            var data = toolData.data[i];
            var color = cornerstoneTools.toolColors.getColorIfActive(data.active);
            var canvasPoint = cornerstone.pixelToCanvas(eventData.element, data.handles.control);

            context.strokeStyle = color;
            context.fillStyle = color;

            //draw selected point
            context.beginPath();
            context.fillRect(canvasPoint.x - 3, canvasPoint.y - 3, 7, 7);

            //get segmentation if necessary
            if (!data.segmentation) {
                getSegmentation(eventData.element, data);
            }

            if (data.segmentation) {
                if (data.segmentation.polygon) {
                    console.log('Drawing polygon');
                    var point, j;
                    //draw polygon
                    context.fillStyle = 'rgba(255, 0, 0, 0.25)';
                    context.beginPath();
                    point = cornerstone.pixelToCanvas(eventData.element, data.handles[(data.segmentation.polygon.length - 1)]);
                    context.moveTo(point.x, point.y);
                    for (j = 0; j < data.segmentation.polygon.length; j++) {
                        point = cornerstone.pixelToCanvas(eventData.element, data.handles[j]);
                        context.lineTo(point.x, point.y);
                    }
                    context.stroke();
                    context.fill();
                    //draw handles
                    context.fillStyle = color;
                    for (j = 0; j < data.segmentation.polygon.length; j++) {
                        context.beginPath();
                        point = cornerstone.pixelToCanvas(eventData.element, data.handles[j]);
                        context.ellipse(point.x, point.y, 2, 2, 0, 0, 2 * Math.PI);
                        context.fill();
                    }
                }
                if (drawMask && data.segmentation.mask && data.segmentation.maskOffset) {
                    //draw mask
                    var xOffset = data.segmentation.maskOffset[0];
                    var yOffset = data.segmentation.maskOffset[1];

                    context.save();
                    context.fillStyle = '#00FF00';

                    var row, column;
                    for (row = 0; row < data.segmentation.mask.length; row++) {
                        for (column = 0; column < data.segmentation.mask[0].length; column++) {
                            var point = cornerstone.pixelToCanvas(eventData.element,
                                {x: column + xOffset, y: row + yOffset});
                            if (data.segmentation.mask[row][column]) {
                                context.fillRect(point.x, point.y, 1, 1); //draw pixel
                            }
                        }
                    }
                    context.restore();
                }
            }

            context.restore();
        }

    }
    ///////// END IMAGE RENDERING ///////

    // module exports
    cornerstoneTools.sake = cornerstoneTools.mouseButtonTool({
        addNewMeasurement: addNewMeasurement,
        createNewMeasurement: createNewMeasurement,
        onImageRendered: onImageRendered,
        pointNearTool: pointNearTool,
        toolType: toolType
    });

    cornerstoneTools.sakeTouch = cornerstoneTools.touchTool({
        addNewMeasurement: addNewMeasurement,
        createNewMeasurement: createNewMeasurement,
        onImageRendered: onImageRendered,
        pointNearTool: pointNearTool,
        toolType: toolType
    });

})($, cornerstone, cornerstoneMath, cornerstoneTools);
