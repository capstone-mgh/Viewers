import { OHIF } from 'meteor/ohif:core';
import { Viewerbase } from 'meteor/ohif:viewerbase';

//TODO List
//half-pixel offset bug
//save

(function($, cornerstone, cornerstoneMath, cornerstoneTools) {

    'use strict';

    var toolType = 'sake';
    var drawMask = false;
    var maxArea = 1000;

    //compute segmentation on frontend
    function getSegmentation(element, measurementData) {
        var image, segmentationResult, polygon, z, propagationDirection;
        z = getZ(element);
        image = cornerstone.getEnabledElement(element).image;
        propagationDirection = Math.sign(z - measurementData.zOrig);

        if (propagationDirection > 0) { //propagate down
            console.log('propagate down');
            measurementData.thresholds[z] = measurementData.thresholds[z] || measurementData.thresholds[z-1];
            segmentationResult = binaryPropagationZ(image, measurementData.segmentation[z-1].mask,
                measurementData.intensity, measurementData.thresholds[z]);
            if (segmentationResult && segmentationResult.area <= maxArea) {
                //continue propagation down
                measurementData.zEnd = Math.min(z+1, measurementData.zMax);
            } else if (measurementData.segmentation[z]) {
                //worked for smaller threshold, limit threshold
                measurementData.thresholds[z] /= 1.1;
                return;
            } else {
                //stop propagation
                measurementData.zEnd = z-1;
                return;
            }
        } else if (propagationDirection < 0) { //propagate up
            console.log('propagate up');
            measurementData.thresholds[z] = measurementData.thresholds[z] || measurementData.thresholds[z+1];
            segmentationResult = binaryPropagationZ(image, measurementData.segmentation[z+1].mask,
                measurementData.intensity, measurementData.thresholds[z]);
            if (segmentationResult && segmentationResult.area <= maxArea) {
                //continue propagation up
                measurementData.zStart = Math.max(z-1, 0);
            } else if (measurementData.segmentation[z]) {
                //worked for smaller threshold, limit threshold
                measurementData.thresholds[z] /= 1.1;
                return;
            } else {
                //stop propagation
                measurementData.zStart = z+1;
                return;
            }
        } else { //propagate from scratch
            console.log('propagate scratch');
            var x = measurementData.requestData.x;
            var y = measurementData.requestData.y;
            measurementData.thresholds[z] = measurementData.thresholds[z] || 0.1; //default
            segmentationResult = binaryPropagation2D(image, [[y, x]],
                measurementData.intensity, measurementData.thresholds[z]);
            if (segmentationResult.area > maxArea) {
                if (measurementData.segmentation[z]) {
                    //worked for smaller threshold, limit threshold
                    measurementData.thresholds[z] /= 1.1;
                } else {
                    //invalid region
                    measurementData.zStart = z+1;
                    cornerstoneTools.removeToolState(element, toolType, measurementData);
                }
                return;
            }
        }

        measurementData.segmentation[z] = segmentationResult;
        syncPolygonToHandles(measurementData, z);
        analyzeSegment(element, measurementData);
    }

    //send request after a delay
    function analyzeSegment(element, measurementData) {
        if (measurementData.analyzeDelayTimer) {
            clearTimeout(measurementData.analyzeDelayTimer);
        }
        measurementData.analyzeDelayTimer = setTimeout(sendAnalyzeRequest, 1000, element, measurementData);
    }

    //serialize polygons off of measurementData
    function serializePolygons(measurementData) {
        var z, zOffset, polygons = [];
        for (z = measurementData.zStart; z <= measurementData.zEnd; z++) {
            if (measurementData.segmentation[z]) {
                polygons.push(measurementData.segmentation[z].polygon);
                zOffset = zOffset || z;
            }
        }
        return {polygons: polygons, zOffset: zOffset};
    }

    //send a request to the ML server
    function sendAnalyzeRequest(element, measurementData) {
        var requestData = $.extend({}, measurementData.requestData, serializePolygons(measurementData));
        console.log(requestData);

        //TODO remove hard coded url
        var url = 'http://104.198.43.42/sake/analyze';
        $.ajax({
          url: url,
          data: requestData,
          method: 'POST'
        }).done(function(data) {
            console.log('getting prediction information');
            measurementData.segmentation.information = JSON.parse(data);
            console.log(measurementData.segmentation.information);
            cornerstone.updateImage(element);
        }).fail(function() {
            console.log('prediction request failed');
        });
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
        var i, z, dx, dy, polygon, controlPoint, handles, changedIndex, segmentation;
        z = getZ(eventData.element);
        segmentation = eventData.measurementData.segmentation;

        if (eventData.toolType !== toolType || !segmentation[z]) {
            return;
        }

        handles = eventData.measurementData.handles;
        controlPoint = eventData.measurementData.segmentation[z].center;

        //process control handle movement
        dx = handles.control.x - controlPoint[0];
        dy = handles.control.y - controlPoint[1];
        if (dx || dy) {
            if (Math.abs(dy) > Math.abs(dx)) { //vertical drag
                if (dy > 0) {
                    console.log("shrink");
                    eventData.measurementData.thresholds[z] /= 1.1;
                    eventData.measurementData.segmentationStale[z] = true;
                    eventData.measurementData.zHandles = false; //invalidate handles
                } else {
                    console.log("grow");
                    eventData.measurementData.thresholds[z] *= 1.1;
                    eventData.measurementData.segmentationStale[z] = true;
                    eventData.measurementData.zHandles = false; //invalidate handles
                }
            }

            //console.log("delete");
            //cornerstoneTools.removeToolState(eventData.element, toolType, eventData.measurementData);
            return;
        }

        polygon = segmentation[z].polygon;
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
            eventData.measurementData.zHandles = false; //invalidate handles
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

    //get center of polygon
    function getPolygonCenter(polygon) {
        var i, xCenter, yCenter;
        xCenter = 0;
        yCenter = 0;
        for (i = 0; i < polygon.length; i++) {
            xCenter += polygon[i][0];
            yCenter += polygon[i][1];
        }
        xCenter = Math.round(xCenter / polygon.length);
        yCenter = Math.round(yCenter / polygon.length);
        return [xCenter, yCenter];
    }

    //get top right corner of polygon
    function getPolygonTopRightCorner(polygon) {
        var i, x, y;
        x = 0;
        y = Infinity;
        for (i = 0; i < polygon.length; i++) {
            x = Math.max(x, polygon[i][0]);
            y = Math.min(y, polygon[i][1]);
        }
        return [x, y];
    }

    //segment
    function binaryPropagation2D(image, stack, intensity, threshold) {
        var pixels, mask, i, j, area, current, pixel, tMin, tMax, polygon, center;
        pixels = image.getPixelData();
        tMin = intensity - threshold * image.maxPixelValue;
        tMax = intensity + threshold * image.maxPixelValue;

        //reached end of propagation
        if (!stack.length) {
            return false;
        }

        //initialize mask array TODO convert to typed arrays?
        mask = [];
        for (i = 0; i < image.rows; i++) {
            mask[i] = [];
            for (j = 0; j < image.columns; j++) {
                mask[i][j] = false;
            }
        }

        //initialize area
        area = stack.length;

        //add initial stack points to mask
        for (i = 0; i < stack.length; i++) {
            current = stack[i];
            mask[current[0]][current[1]] = true;
        }

        //flood-fill propagate
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
        polygon = getContourPolygon(mask);
        center = getPolygonCenter(polygon);
        return {mask: mask, area: area, polygon: polygon, center: center};
    }

    function binaryPropagationZ(image, templateMask, intensity, threshold) {
        var i, j, stack, pixels, pixel, tMin, tMax;
        pixels = image.getPixelData();
        tMin = intensity - threshold * image.maxPixelValue;
        tMax = intensity + threshold * image.maxPixelValue;
        stack = [];
        for (i = 0; i < image.rows; i++) {
            for (j = 0; j < image.columns; j++) {
                if (templateMask[i][j]) {
                    pixel = pixels[i * image.columns + j];
                    if (pixel > tMin && pixel < tMax) {
                        stack.push([i, j]);
                    }
                }
            }
        }
        return binaryPropagation2D(image, stack, intensity, threshold);
    }

    function getZ(element) {
        var stackData = cornerstoneTools.getToolState(element, 'stack');
        if (!stackData || !stackData.data || !stackData.data.length) {
            console.log('no stack data available');
            return;
        }
        return stackData.data[0].currentImageIdIndex;
    }

    function saveCallback(element) {
        console.log('Save');
        var toolData = cornerstoneTools.getToolState(element, toolType);
        if (!toolData.data || !toolData.data.length) {
            return;
        }
        var nodules = [];
        for (var i = 0; i < toolData.data.length; i++) {
            nodules.push(serializePolygons(toolData.data[i]));
        }
        var requestData = $.extend({}, toolData.data[0].requestData, {nodules: nodules});
        console.log(requestData);

        //TODO remove hard coded url
        var url = 'http://104.198.43.42/sake/save';
        $.ajax({
          url: url,
          data: requestData,
          method: 'POST'
        }).done(function(data) {
            console.log('saving nodules');
            console.log(JSON.parse(data));
        }).fail(function() {
            console.log('saving failed');
        });
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
        //create the measurement data for this tool
        var element = mouseEventData.element;
        var x = Math.round(mouseEventData.currentPoints.image.x);
        var y = Math.round(mouseEventData.currentPoints.image.y);
        var z = getZ(element);

        var imageIds = cornerstoneTools.getToolState(element, 'stack').data[0].imageIds;
        var currentImageId = imageIds[z];
        //TODO handle missing metadata?
        var imageMetadata = OHIF.viewer.metadataProvider.getMetadata(currentImageId);
        var viewport = cornerstone.getViewport(element);

        //var toolStateManager = cornerstoneTools.getElementToolStateManager(element);

        //extract intensity of selected pixel
        var image = cornerstone.getEnabledElement(element).image;
        var intensity = image.getPixelData()[y * image.columns + x];

        var measurementData = {
            zStart: Math.max(0, z-1),
            zEnd: Math.min(z+1, imageIds.length - 1),
            zOrig: z,
            zMax: imageIds.length - 1,
            intensity: intensity,
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
            requestData: {
                x: x,
                y: y,
                z: z,
                patientName: imageMetadata.patient.name,
                windowWidth: viewport.voi.windowWidth,
                windowCenter: viewport.voi.windowCenter,
                seriesInstanceUid: imageMetadata.series.seriesInstanceUid,
                sopInstanceUid: imageMetadata.instance.sopInstanceUid
            },
            thresholds: {},
            segmentation: {},
            segmentationStale: {}
        };

        // associate data to toolstate
        cornerstoneTools.addToolState(element, toolType, measurementData);
        $(element).on('CornerstoneToolsMeasurementModified', dragCallback);

        // bind save button
        OHIF.viewer.functionList.sakeSave = saveCallback;

        return measurementData;
    }
    ///////// END ACTIVE TOOL ///////

    function pointNearTool(element, data, coords) {
        //TODO fix to detect inside polygon
        var distanceToPoint = cornerstoneMath.point.distance(data.handles.control, coords);
        return (distanceToPoint < 25);
    }

    //copies a given polygon to handles
    function syncPolygonToHandles(data, z) {
        var i, center, polygon;
        if (z === data.zHandles) {
            return; //handles correct
        }
        polygon = data.segmentation[z].polygon;
        center = data.segmentation[z].center;
        //add vertex handles
        for (i = 0; i < polygon.length; i++) {
            //create handle if necessary
            if (!data.handles[i]) {
                data.handles[i] = {highlight: true, active: false};
            }
            data.handles[i].x = polygon[i][0];
            data.handles[i].y = polygon[i][1];
        }
        //add control handle
        data.handles.control.x = center[0];
        data.handles.control.y = center[1];
        //set handles z on data
        data.zHandles = z;
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
        context.font = '14px Arial';

        var z = getZ(eventData.element);

        context.setTransform(1, 0, 0, 1, 0, 0);

        //compute marker size TODO look into way of getting the scale directly
        var p0 = cornerstone.pixelToCanvas(eventData.element, {x: 0, y: 0});
        var p1 = cornerstone.pixelToCanvas(eventData.element, {x: 1, y: 1});
        var markerSize = Math.max(2, 0.2 * cornerstoneMath.point.distance(p0, p1));
        context.lineWidth = 0.5 * markerSize;

        for (var i = 0; i < toolData.data.length; i++) {
            var data = toolData.data[i];
            if (z < data.zStart || data.zEnd < z) {
                continue; //segment not on current slice
            }

            context.save();
            var color = cornerstoneTools.toolColors.getColorIfActive(data.active);
            var point = cornerstone.pixelToCanvas(eventData.element, data.handles.control);

            context.strokeStyle = color;
            context.fillStyle = color;

            //draw selected point
            context.beginPath();
            context.fillRect(point.x - markerSize, point.y - markerSize, 2 * markerSize + 1, 2 * markerSize + 1);

            //get segmentation if necessary
            if (!data.segmentation[z] || data.segmentationStale[z]) {
                getSegmentation(eventData.element, data);
                data.segmentationStale[z] = false;
                //check segmentation exists again
                if (z < data.zStart || data.zEnd < z) {
                    continue; //segment not on current slice
                }
            }

            var polygon = data.segmentation[z].polygon;

            if (polygon) {
                //create handles
                syncPolygonToHandles(data, z);

                console.log('Drawing polygon');
                var j;
                //draw polygon
                context.fillStyle = 'rgba(255, 0, 0, 0.25)';
                context.beginPath();
                point = cornerstone.pixelToCanvas(eventData.element, data.handles[(polygon.length - 1)]);
                context.moveTo(point.x, point.y);
                for (j = 0; j < polygon.length; j++) {
                    point = cornerstone.pixelToCanvas(eventData.element, data.handles[j]);
                    context.lineTo(point.x, point.y);
                }
                context.stroke();
                context.fill();
                //draw handles
                context.fillStyle = color;
                for (j = 0; j < polygon.length; j++) {
                    context.beginPath();
                    point = cornerstone.pixelToCanvas(eventData.element, data.handles[j]);
                    context.ellipse(point.x, point.y, markerSize, markerSize, 0, 0, 2 * Math.PI);
                    context.fill();
                }
            }

            var information = data.segmentation.information;
            if (information) {
                var corner = getPolygonTopRightCorner(polygon);
                corner = cornerstone.pixelToCanvas(eventData.element, {x: corner[0], y: corner[1]});
                context.fillText('Mal: ' + information.malignancy.toFixed(2), corner.x + 3 * markerSize, corner.y);
                context.fillText('Size: ' + information.percentile.toFixed(2), corner.x + 3 * markerSize, corner.y + 16);
            }

            var row, column, point, mask;
            mask = data.segmentation[z].mask;
            if (drawMask && mask) {
                //draw mask
                context.save();
                context.fillStyle = '#00FF00';
                for (row = 0; row < mask.length; row++) {
                    for (column = 0; column < mask[0].length; column++) {
                        point = cornerstone.pixelToCanvas(eventData.element, {x: column, y: row});
                        if (mask[row][column]) {
                            context.fillRect(point.x, point.y, 1, 1); //draw pixel
                        }
                    }
                }
                context.restore();
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
