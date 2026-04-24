define(function (require, exports, module) {
    "use strict";

    var ClientLoader = require("./src/languageTools/ClientLoader"),
        initiateService = require("./src/client").initiateService,
        AppInit = brackets.getModule("utils/AppInit");

    AppInit.appReady(function () {
        if (Phoenix.isNativeApp) {
            initiateService(null, true);
            // TODO: check this
            ClientLoader.on("languageClientModuleInitialized", initiateService);
        }
    });
});
