import { OHIF } from 'meteor/ohif:core';
import { Viewerbase } from 'meteor/ohif:viewerbase';

(function($, cornerstone, cornerstoneMath, cornerstoneTools) {

    'use strict';

    var toolType = 'sake';

    function getSegmentation(element, measurementData) {
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
        }).fail(function() {
            console.log('ajax get request failed');
            console.log('drawing dummy data!');
            var x = measurementData.requestData.x,
                y = measurementData.requestData.y,
                z = measurementData.requestData.z;
            if (z % 7 === 3) {
                measurementData.segmentation = {};
            } else {
                measurementData.segmentation = {
                    mask: [
                        [1, 0, 0 ,0 ,1],
                        [0, 1, 0 ,1 ,0],
                        [0, 0, 1 ,0 ,0],
                        [0, 1, 0 ,1 ,0],
                        [1, 0, 0 ,0 ,1],
                    ],
                    maskOffset: [x - 2, y - 2],
                    polygon: [[x, y-7], [x+3, y-3], [x+4, y], [x+3, y+7], [x, y+7], [x-3, y+3], [x-4, y], [x-3, y-7]]
                };
            }
        }).always(function() {
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

                // var image = cornerstone.getEnabledElement(element).image;
                // measurementData.segmentation.mask = segment(image, xOrig, yOrig, 0.1);
                // measurementData.segmentation.maskOffset = [0, 0];
                // polygon = getContourPolygon(measurementData.segmentation.mask);
                // measurementData.segmentation.polygon = polygon;

                for (var i = 0; i < polygon.length; i++) {
                    measurementData.handles[i] = {
                        x: polygon[i][0],
                        y: polygon[i][1],
                        highlight: true,
                        active: false
                    }
                }
            }
            measurementData.segmentationPending = false;
            cornerstone.updateImage(element);
        });
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
                start: {
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
                xOrig: xOrig,
                yOrig: yOrig,
                zOrig: zOrig,
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
        if (eventData.toolType !== toolType) {
            return;
        }

        var i, dx, dy,
            polygon = eventData.measurementData.segmentation.polygon,
            handles = eventData.measurementData.handles,
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
    function getContourPolygon(mask) {
        var i, j, start, polygon, directions, d, iDir, iDirLast, dir, vertexCount;
        vertexCount = 0;
        polygon = [];
        directions = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
        iDirLast = 0;
        start = getEdgePoint(mask);
        polygon.push(start);
        i = start[0];
        j = start[1];
        //traverse edge of polygon
        do {
            //find next edge
            for (d = 0; d < 8; d++) {
                iDir = (d + iDirLast + 5) % 8;
                dir = directions[iDir];
                if (mask[i + dir[0]] && mask[i + dir[0]][j + dir[1]]) {
                    i += dir[0];
                    j += dir[1];
                    polygon.push([i, j]);
                    iDirLast = iDir;
                    break;
                }
            }
        } while ((i !== start[0] || j !== start[1]) && ++vertexCount < 10000)
        return polygon;
    }

    //segment
    function segment(image, x, y, threshold) {
        var pixels, mask, tMin, tMax, i, j;
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
        while (stack.length) {
            current = stack.pop();
            i = current[0];
            j = current[1];
            if (i < image.columns - 1 && !mask[i+1][j]) {
                pixel = pixels[(i + 1) * image.columns + j];
                if (pixel > tMin && pixel < tMax) {
                    mask[i+1][j] = true;
                    stack.push([i+1, j]);
                }
            }
            if (i > 0 && !mask[i-1][j]) {
                pixel = pixels[(i - 1) * image.columns + j];
                if (pixel > tMin && pixel < tMax) {
                    mask[i-1][j] = true;
                    stack.push([i-1, j]);
                }
            }
            if (j < image.rows - 1 && !mask[i][j+1]) {
                pixel = pixels[i * image.columns + j + 1];
                if (pixel > tMin && pixel < tMax) {
                    mask[i][j+1] = true;
                    stack.push([i, j+1]);
                }
            }
            if (j > 0 && !mask[i][j-1]) {
                pixel = pixels[i * image.columns + j - 1];
                if (pixel > tMin && pixel < tMax) {
                    mask[i][j-1] = true;
                    stack.push([i, j-1]);
                }
            }
        }

        return mask;
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
        var distanceToPoint = cornerstoneMath.point.distance(data.handles.start, coords);
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
            var canvasPoint = cornerstone.pixelToCanvas(eventData.element, data.handles.start);

            context.fillStyle = color;
            context.strokeStyle = color;
            context.beginPath();
            //(x, y, radiusX, radiusY, rotation, startAngle, endAngle, [anticlockwise]);
            context.ellipse(canvasPoint.x, canvasPoint.y, 2, 2, 0, 0, 2 * Math.PI)
            context.fill();

            if (data.segmentation) {
                //helper to convert coordinates from image to canvas
                var pixelPairToCanvas = function(pair) {
                    return cornerstone.pixelToCanvas(eventData.element, {x: pair[0], y: pair[1]});
                }
                if (data.segmentation.polygon) {
                    console.log('Drawing polygon');
                    //draw polygon
                    context.beginPath();
                    var point = cornerstone.pixelToCanvas(eventData.element, data.handles[(data.segmentation.polygon.length - 1)]);
                    context.moveTo(point.x, point.y);
                    for (var j = 0; j < data.segmentation.polygon.length; j++) {
                        point = cornerstone.pixelToCanvas(eventData.element, data.handles[j]);
                        context.ellipse(point.x, point.y, 2, 2, 0, 0, 2 * Math.PI);
                        context.lineTo(point.x, point.y);
                    }
                    context.stroke();
                }
                if (data.segmentation.mask && data.segmentation.maskOffset) {
                    //draw mask
                    var xOffset = data.segmentation.maskOffset[0];
                    var yOffset = data.segmentation.maskOffset[1];

                    context.save();
                    context.fillStyle = '#FF0000';

                    for (var xMask = 0; xMask < data.segmentation.mask.length; xMask++) {
                        for (var yMask = 0; yMask < data.segmentation.mask[0].length; yMask++) {
                            var point = pixelPairToCanvas([xMask + xOffset, yMask + yOffset]);
                            if (data.segmentation.mask[xMask][yMask]) {
                                //draw pixel
                                context.fillRect(point.x, point.y, 1, 1);
                            }
                        }
                    }

                    context.restore();

                }
            } else if (!data.segmentationPending) {
                //make rest call to get segmentation
                getSegmentation(eventData.element, data);
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
