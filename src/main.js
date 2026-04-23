define(function (require, exports, module) {
    "use strict";

    var ClientLoader = require("languageTools/ClientLoader"),
        initiateService = require("client").initiateService,
        AppInit = brackets.getModule("utils/AppInit");

    AppInit.appReady(function () {
        // nb: Please enable `Debug menu> Phoenix code diagnostic tools> enable detailed logs` to view all console logs.`
        console.log("hello world");

        if (Phoenix.isNativeApp) {
            initiateService(null, true);
            // TODO: check this
            ClientLoader.on("languageClientModuleInitialized", initiateService);
        }
    });
});
