import { Template } from 'meteor/templating';
import { OHIF } from 'meteor/ohif:core';

/*
 * action: controls an element that will trigger some form API's method
 */
OHIF.mixins.action = new OHIF.Mixin({
    dependencies: 'formItem',
    composition: {
        onRendered() {
            const instance = Template.instance();
            const component = instance.component;

            // Add the form-action identification class
            component.$element.addClass('form-action');
        },

        events: {
            'click .form-action'(event, instance) {
                event.preventDefault();
                const component = instance.component;

                // Extract action, disabled state and params
                const { action } = instance.data;
                const params = instance.data.params ? instance.data.params : event;

                // Stop here if the component is disabled
                if (component.$element.hasClass('disabled')) return;

                // Get the current component's API
                const api = component.getApi();

                // Stop here calling the action if it's a function
                if (typeof action === 'function') {
                    component.actionResult = action.call(this, params);
                    return component.actionResult;
                }

                // Stop here if no API or action was defined
                if (!api || !action || typeof api[action] !== 'function') return;

                // Call the defined action function
                component.actionResult = api[action].call(this, params);

                return component.actionResult;
            }
        }
    }
});
