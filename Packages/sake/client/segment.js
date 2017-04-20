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
            console.log(data);
            measurementData.segmentation = JSON.parse(data);
        }).fail(function() {
            console.log('ajax get request failed');
            console.log('drawing dummy data!');
            var x = measurementData.requestData.x,
                y = measurementData.requestData.y;
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
        }).always(function() {
            measurementData.segmentationPending = false;
            cornerstone.updateImage(element);
        });
    }

    function createNewMeasurementInternal(element, x, y, zOffset) {
        var stackData = cornerstoneTools.getToolState(element, 'stack');
        if (!stackData || !stackData.data || !stackData.data.length) {
            console.log('no stack data available');
            return;
        }
        var imageIds = stackData.data[0].imageIds;
        var currentImageIdIndex = stackData.data[0].currentImageIdIndex + zOffset;
        if (currentImageIdIndex < 0 || currentImageIdIndex >= imageIds.length) {
            return; //out of range
        }

        var currentImageId = imageIds[currentImageIdIndex];
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
            propagationDirection: Math.sign(zOffset),
            requestData: {
                x: Math.round(x),
                y: Math.round(y),
                z: currentImageIdIndex,
                patientName: imageMetadata.patient.name,
                windowWidth: viewport.voi.windowWidth,
                windowCenter: viewport.voi.windowCenter,
                seriesInstanceUid: imageMetadata.series.seriesInstanceUid,
                sopInstanceUid: imageMetadata.instance.sopInstanceUid
            }
        };

        // associate this data with this imageId so we can render it and manipulate it
        cornerstoneTools.addToolState(element, toolType, measurementData, currentImageId);
        return measurementData;
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
        var x = mouseEventData.currentPoints.image.x;
        var y = mouseEventData.currentPoints.image.y;

        return createNewMeasurementInternal(mouseEventData.element, x, y, 0);
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
                    var point = pixelPairToCanvas(data.segmentation.polygon[data.segmentation.polygon.length - 1]);
                    context.moveTo(point.x, point.y);
                    for (var j = 0; j < data.segmentation.polygon.length; j++) {
                        point = pixelPairToCanvas(data.segmentation.polygon[j]);
                        context.lineTo(point.x, point.y);
                    }
                    context.stroke();
                }
                if (data.segmentation.mask && data.segmentation.maskOffset) {
                    console.log('Drawing mask');
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
