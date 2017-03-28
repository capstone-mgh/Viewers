import { OHIF } from 'meteor/ohif:core';
import { Viewerbase } from 'meteor/ohif:viewerbase';

(function($, cornerstone, cornerstoneMath, cornerstoneTools) {

    'use strict';

    var toolType = 'sake';

    ///////// BEGIN ACTIVE TOOL ///////
    function addNewMeasurement(mouseEventData) {
        var measurementData = createNewMeasurement(mouseEventData);
        if (!measurementData) {
            return;
        }

        // associate this data with this imageId so we can render it and manipulate it
        cornerstoneTools.addToolState(mouseEventData.element, toolType, measurementData);
        cornerstone.updateImage(mouseEventData.element);
    }

    function createNewMeasurement(mouseEventData) {
        //create the measurement data for this tool with the end handle activated
        var x = mouseEventData.currentPoints.image.x;
        var y = mouseEventData.currentPoints.image.y;

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
            }
        };

        //get segmentation
        var url = "http://sakeviewer.com/api/v1/test/" + Math.round(x) + "/" + Math.round(y);

        console.log("Getting segmentation from " + url);
        console.log("Image id " + cornerstone.getEnabledElement(mouseEventData.element).image.imageId);

        $.ajax({
          url: url
        }).done(function(data) {
            console.log("ajax get request returned");
            console.log(data);
            measurementData.segmentation = data;
            cornerstone.updateImage(mouseEventData.element);
        }).fail(function() {
            console.log("ajax get request failed, drawing dummy segmentation");
            //dummy response
            measurementData.segmentation = [[x, y-7], [x+3, y-3], [x+4, y], [x+3, y+7], [x, y+7], [x-3, y+3], [x-4, y], [x-3, y-7]];
            cornerstone.updateImage(mouseEventData.element);
        });

        return measurementData;
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
        var context = eventData.canvasContext.canvas.getContext('2d');
        context.setTransform(1, 0, 0, 1, 0, 0);

        for (var i = 0; i < toolData.data.length; i++) {
            context.save();

            var data = toolData.data[i];
            var color = cornerstoneTools.toolColors.getColorIfActive(data.active);
            var canvasPoint = cornerstone.pixelToCanvas(eventData.element, data.handles.start);

            context.fillStyle = color;
            context.beginPath();
            //(x, y, radiusX, radiusY, rotation, startAngle, endAngle, [anticlockwise]);
            context.ellipse(canvasPoint.x, canvasPoint.y, 2, 2, 0, 0, 2 * Math.PI)
            context.fill();

            if (data.segmentation) {
                //helper to convert coordinates from image to canvas
                var pixelPairToCanvas = function(pair) {
                    return cornerstone.pixelToCanvas(eventData.element, {x: pair[0], y: pair[1]});
                }
                //draw polygon
                context.beginPath();
                var point = pixelPairToCanvas(data.segmentation[data.segmentation.length - 1]);
                context.moveTo(point.x, point.y);
                for (var j = 0; j < data.segmentation.length; j++) {
                    point = pixelPairToCanvas(data.segmentation[j]);
                    context.lineTo(point.x, point.y);
                }
                context.fill();
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
