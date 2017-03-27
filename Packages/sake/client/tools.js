import { Meteor } from 'meteor/meteor';
import { Viewerbase } from 'meteor/ohif:viewerbase';

Meteor.startup(function() {
    const toolManager = Viewerbase.toolManager;

    toolManager.addTool('sake', {
        mouse: cornerstoneTools.sake,
        touch: cornerstoneTools.sakeTouch
    });

    // Update default state for tools making sure each tool is only inserted once
    let currentDefaultStates = toolManager.getToolDefaultStates();
    let newDefaultStates = {
        deactivate: ['sake']
        //enable: [ 'scaleOverlayTool' ],
        //deactivate: ['bidirectional', 'nonTarget', 'length', 'targetCR', 'targetUN', 'targetEX'],
        //activate: ['deleteLesionKeyboardTool']
    };

    for (let state in newDefaultStates) {
        newDefaultStates[state].forEach(function(tool) {
            let tools = currentDefaultStates[state];
            // make sure each tool is only inserted once
            if (tools && tools.indexOf(tool) < 0) {
                tools.push(tool);
            }
        });
    }

    toolManager.setToolDefaultStates(currentDefaultStates);
});
