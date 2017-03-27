import { OHIF } from 'meteor/ohif:core';
import { Viewerbase } from 'meteor/ohif:viewerbase';

(function($, cornerstone, cornerstoneMath, cornerstoneTools) {

    'use strict';

    var toolType = 'sake';

    ///////// BEGIN ACTIVE TOOL ///////
    function addNewMeasurement(mouseEventData) {
        var element = mouseEventData.element;

        var measurementData = createNewMeasurement(mouseEventData);
        if (!measurementData) {
            return;
        }

        // associate this data with this imageId so we can render it and manipulate it
        cornerstoneTools.addToolState(mouseEventData.element, toolType, measurementData);
        cornerstone.updateImage(element);
    }

    function createNewMeasurement(mouseEventData) {
        //create the measurement data for this tool with the end handle activated
        var measurementData = {
            visible: false,
            active: true,
            handles: {
                start: {
                    x: mouseEventData.currentPoints.image.x,
                    y: mouseEventData.currentPoints.image.y,
                    highlight: true,
                    active: false
                }
            }
        };

        //get segmentation
        var url = "http://sakeviewer.com/api/v1/test/" + Math.round(mouseEventData.currentPoints.image.x) + "/" + Math.round(mouseEventData.currentPoints.image.y);

        console.log("Getting segmentation from " + url);

        $.ajax({
          url: url,
          success: function(data) {
            console.log("ajax request returned following");
            console.log(data);
          }
        });

        return measurementData;
    }

    ///////// END ACTIVE TOOL ///////

    function pointNearTool(element, data, coords) {
        // var lineSegment = {
        //     start: cornerstone.pixelToCanvas(element, data.handles.start),
        //     end: cornerstone.pixelToCanvas(element, data.handles.end)
        // };
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
            // var canvasPoint = cornerstone.pixelToCanvas(eventData.element, data);

            context.fillStyle = color;
            context.beginPath();
            //(x, y, radiusX, radiusY, rotation, startAngle, endAngle, [anticlockwise]);
            context.ellipse(canvasPoint.x, canvasPoint.y, 5, 5, 0, 0, 2 * Math.PI)
            context.fill();

            context.restore();
        }
    }
    ///////// END IMAGE RENDERING ///////

    //cornerstoneTools.sake = cornerstoneTools.simpleMouseButtonTool(mouseDownCallback)

    // module exports
    cornerstoneTools.sake = cornerstoneTools.mouseButtonTool({
        //mouseDownCallback: mouseDownCallback,
        addNewMeasurement: addNewMeasurement,
        createNewMeasurement: createNewMeasurement,
        onImageRendered: onImageRendered,
        pointNearTool: pointNearTool,
        toolType: toolType
    });

    cornerstoneTools.sakeTouch = cornerstoneTools.touchTool({
        //mouseDownCallback: mouseDownCallback,
        addNewMeasurement: addNewMeasurement,
        createNewMeasurement: createNewMeasurement,
        onImageRendered: onImageRendered,
        pointNearTool: pointNearTool,
        toolType: toolType
    });

})($, cornerstone, cornerstoneMath, cornerstoneTools);
