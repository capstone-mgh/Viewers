Package.describe({
    name: 'sake',
    summary: 'SAKE Segmentation Plugin',
    version: '0.0.1'
});

Package.onUse(function(api) {
    api.versionsFrom('1.4');

    api.use('ecmascript');
    api.use('standard-app-packages');
    api.use('jquery');
    api.use('stylus');
    api.use('random');

    api.use('validatejs');

    // Template overriding
    api.use('aldeed:template-extension@4.0.0');

    // Our custom packages
    api.use('ohif:design');
    api.use('ohif:core');
    api.use('ohif:cornerstone');

    api.addFiles('client/index.js', 'client');

    //Assets
    const assets = [
        'assets/sakelogo.svg'
    ];
    api.addAssets(assets, 'client');

});
