/*
 * Copyright (c) 2019 - present Adobe. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */
define(function (require, exports, module) {
    "use strict";

    var LanguageTools = require("./languageTools/LanguageTools"),
        ClientLoader = require("./languageTools/ClientLoader"),
        PreferencesManager = brackets.getModule("preferences/PreferencesManager"),
        ExtensionUtils = brackets.getModule("utils/ExtensionUtils"),
        ProjectManager = brackets.getModule("project/ProjectManager"),
        EditorManager =  brackets.getModule("editor/EditorManager"),
        LanguageManager =  brackets.getModule("language/LanguageManager"),
        CodeHintManager = brackets.getModule("editor/CodeHintManager"),
        QuickOpen = brackets.getModule("search/QuickOpen"),
        ParameterHintManager = brackets.getModule("features/ParameterHintsManager"),
        JumpToDefManager = brackets.getModule("features/JumpToDefManager"),
        FindReferencesManager = brackets.getModule("features/FindReferencesManager"),
        CodeInspection = brackets.getModule("language/CodeInspection"),
        DefaultProviders = require("./languageTools/DefaultProviders"),
        CodeHintsProvider = require("./CodeHintsProvider").CodeHintsProvider,
        SymbolProviders = require("./SymbolProviders").SymbolProviders,
        DefaultEventHandlers = require("./languageTools/DefaultEventHandlers"),
        Strings             = brackets.getModule("strings"),
        Dialogs             = brackets.getModule("widgets/Dialogs"),
        DefaultDialogs      = brackets.getModule("widgets/DefaultDialogs"),
        Commands               = brackets.getModule("command/Commands"),
        CommandManager         = brackets.getModule("command/CommandManager"),
        StringUtils             = brackets.getModule("utils/StringUtils");

    var DEBUG_OPEN_PREFERENCES_IN_SPLIT_VIEW  = "debug.openPrefsInSplitView";

    function ClientHandler(langs) {
        this._langs = langs,
        this._client = null,
        this.evtHandler,
        this.lspServerRunning = false,
        this.serverCapabilities,
        this.currentRootPath,
        this.chProvider = null,
        this.phProvider = null,
        this.lProvider = null,
        this.jdProvider = null,
        this.dSymProvider = null,
        this.pSymProvider = null,
        this.refProvider = null,
        this.providersRegistered = false;
    }

    ClientHandler.prototype.handleProjectOpen = function (event, directory) {
        this.lProvider.clearExistingResults();

        if (this.serverCapabilities["workspace"] && this.serverCapabilities["workspace"]["workspaceFolders"]) {
            this._client.notifyProjectRootsChanged({
                foldersAdded: [directory.fullPath],
                foldersRemoved: [this.currentRootPath]
            });
            this.currentRootPath = directory.fullPath;
        } else {
            this._client.restart({
                rootPath: directory.fullPath
            }).then(this.handlePostLspServerStart);
        }
    };

    ClientHandler.prototype.resetClientInProviders = function () {
        var logErr = "LspTooling: Can't reset client for : ";
        this.chProvider ? this.chProvider.setClient(this._client) : console.log(logErr, "CodeHintsProvider");
        this.phProvider ? this.phProvider.setClient(this._client) : console.log(logErr, "ParameterHintsProvider");
        this.jdProvider ? this.jdProvider.setClient(this._client) : console.log(logErr, "JumpToDefProvider");
        this.dSymProvider ? this.dSymProvider.setClient(this._client) : console.log(logErr, "DocumentSymbolsProvider");
        this.pSymProvider ? this.pSymProvider.setClient(this._client) : console.log(logErr, "ProjectSymbolsProvider");
        this.refProvider ? this.refProvider.setClient(this._client) : console.log(logErr, "FindReferencesProvider");
        this.lProvider ? this.lProvider.setClient(this._client) : console.log(logErr, "LintingProvider");
        this._client.addOnCodeInspection(this.lProvider.setInspectionResults.bind(this.lProvider));
    };

    ClientHandler.prototype.registerToolingProviders = function () {
        this.chProvider = new CodeHintsProvider(this._client),
        this.phProvider = new DefaultProviders.ParameterHintsProvider(this._client),
        this.lProvider = new DefaultProviders.LintingProvider(this._client),
        this.jdProvider = new DefaultProviders.JumpToDefProvider(this._client);
        this.dSymProvider = new SymbolProviders.DocumentSymbolsProvider(this._client);
        this.pSymProvider = new SymbolProviders.ProjectSymbolsProvider(this._client);
        this.refProvider = new DefaultProviders.ReferencesProvider(this._client);

        JumpToDefManager.registerJumpToDefProvider(this.jdProvider, this._langs, 0);
        CodeHintManager.registerHintProvider(this.chProvider, this._langs, 0);
        ParameterHintManager.registerHintProvider(this.phProvider, this._langs, 0);
        FindReferencesManager.registerFindReferencesProvider(this.refProvider, this._langs, 0);
        FindReferencesManager.setMenuItemStateForLanguage();

        CodeInspection.register(this._langs, {
            name: "lsp-" + this._langs[0],
            scanFileAsync: this.lProvider.getInspectionResultsAsync.bind(this.lProvider)
        });

        //Attach plugin for Document Symbols
        QuickOpen.addQuickOpenPlugin({
            name: "Document Symbols",
            label: Strings.CMD_FIND_DOCUMENT_SYMBOLS + "\u2026",
            languageIds: this._langs,
            search: this.dSymProvider.search.bind(this.dSymProvider),
            match: this.dSymProvider.match.bind(this.dSymProvider),
            itemFocus: this.dSymProvider.itemFocus.bind(this.dSymProvider),
            itemSelect: this.dSymProvider.itemSelect.bind(this.dSymProvider),
            resultsFormatter: this.dSymProvider.resultsFormatter.bind(this.dSymProvider)
        });

        CommandManager.get(Commands.NAVIGATE_GOTO_DEFINITION).setEnabled(true);

        //Attach plugin for Project Symbols
        QuickOpen.addQuickOpenPlugin({
            name: "Project Symbols",
            label: Strings.CMD_FIND_PROJECT_SYMBOLS + "\u2026",
            languageIds: this._langs,
            search: this.pSymProvider.search.bind(this.pSymProvider),
            match: this.pSymProvider.match.bind(this.pSymProvider),
            itemFocus: this.pSymProvider.itemFocus.bind(this.pSymProvider),
            itemSelect: this.pSymProvider.itemSelect.bind(this.pSymProvider),
            resultsFormatter: this.pSymProvider.resultsFormatter.bind(this.pSymProvider)
        });

        CommandManager.get(Commands.NAVIGATE_GOTO_DEFINITION_PROJECT).setEnabled(true);

        this._client.addOnCodeInspection(this.lProvider.setInspectionResults.bind(this.lProvider));

        this.providersRegistered = true;
    };

    ClientHandler.prototype.addEventHandlers = function () {
        this._client.addOnLogMessage(function () {});
        this._client.addOnShowMessage(function (msgObj) {
            console.log("lsp show message: " + msgObj.message);
        });
        this.evtHandler = new DefaultEventHandlers.EventPropagationProvider(this._client);
        this.evtHandler.registerClientForEditorEvent();
        this.lProvider._validateOnType = true;
        this._client.addOnProjectOpenHandler(this.handleProjectOpen);
    };

    ClientHandler.prototype.showErrorPopUp = function (err) {
        if(!err) {
            return;
        }

        var localizedErrStr = "";

        if (typeof (err) === "string") {
            localizedErrStr = Strings[err];
        } else {
            localizedErrStr = StringUtils.format(Strings[err[0]], err[1]);
        }

        if(!localizedErrStr) {
            console.error("Tooling Error: " + err);
            return;
        }

        var Buttons = [
            { className: Dialogs.DIALOG_BTN_CLASS_NORMAL, id: Dialogs.DIALOG_BTN_CANCEL,
                text: Strings.CANCEL },
            { className: Dialogs.DIALOG_BTN_CLASS_PRIMARY, id: Dialogs.DIALOG_BTN_DOWNLOAD,
                text: Strings.OPEN_PREFERENNCES}
        ];

        Dialogs.showModalDialog(
            DefaultDialogs.DIALOG_ID_ERROR,
            "Server Error",
            localizedErrStr,
            Buttons
        ).done(function (id) {
            if (id === Dialogs.DIALOG_BTN_DOWNLOAD) {
                if (CommandManager.get(DEBUG_OPEN_PREFERENCES_IN_SPLIT_VIEW)) {
                    CommandManager.execute(DEBUG_OPEN_PREFERENCES_IN_SPLIT_VIEW);
                } else {
                    CommandManager.execute(Commands.CMD_OPEN_PREFERENCES);
                }
            }
        });
    };

    ClientHandler.prototype.handlePostLspServerStart = function () {
        if (!this.lspServerRunning) {
            this.lspServerRunning = true;

            if (this.providersRegistered) {
                this.resetClientInProviders();
            } else {
                this.registerToolingProviders();
            }

            this.addEventHandlers();

            this._langs.forEach(function (lang) {
                EditorManager.off("activeEditorChange." + lang);
                LanguageManager.off("languageModified." + lang);
            });
        }

        this.evtHandler.handleActiveEditorChange(null, EditorManager.getActiveEditor());
        this.currentRootPath = ProjectManager.getProjectRoot()._path;
    };

    ClientHandler.prototype.runLspServer = function () {
        if (this._client) {
            var startFunc = this._client.start.bind(this._client);
            var self = this;

            if (this.lspServerRunning) {
                startFunc = this._client.restart.bind(this._client);
            }

            this.currentRootPath = ProjectManager.getProjectRoot()._path;

            startFunc({
                rootPath: this.currentRootPath.slice(6)
            }).then(function (result) {
                console.log("Language Server started");
                self.serverCapabilities = result.capabilities;
                self.handlePostLspServerStart();
            });
        }
    };

    ClientHandler.prototype.activeEditorChangeHandler = function (event, current) {
        if (current) {
            var language = current.document.getLanguage();

            this._langs.forEach(lang => {
                if (language.getId() === lang) {
                    this.runLspServer();
                    EditorManager.off("activeEditorChange." + lang);
                    LanguageManager.off("languageModified." + lang);
                }
            });
        }
    };

    ClientHandler.prototype.languageModifiedHandler = function (event, language) {
        this._langs.forEach(lang => {
            if (language && language.getId() === lang) {
                this.runLspServer();
                EditorManager.off("activeEditorChange." + lang);
                LanguageManager.off("languageModified." + lang);
            }
        });
    };

    ClientHandler.prototype.init = function (config) {
        this.lspServerRunning = false;

        var langs = config.langs;
        var clientHandler = this;

        LanguageTools.initiateToolingService(langs[0], langs, config).done(function (client) {
            clientHandler._client = client;

            langs.forEach(lang => {
                //Attach only once
                EditorManager.off("activeEditorChange." + lang);
                EditorManager.on("activeEditorChange." + lang, clientHandler.activeEditorChangeHandler.bind(clientHandler));
                //Attach only once
                LanguageManager.off("languageModified." + lang);
                LanguageManager.on("languageModified." + lang, clientHandler.languageModifiedHandler.bind(clientHandler));
                clientHandler.activeEditorChangeHandler(null, EditorManager.getActiveEditor());
            });
        });
    };

    function initiateService (_, onAppReady) {
        if (onAppReady) {
            console.log("LSP tooling: Starting the service");
        } else {
            console.log("LSP tooling: Something went wrong. Restarting the service");
        }

        var lspLanguages = PreferencesManager.get("lsp.languages");

        PreferencesManager.on("change", "lsp.languages", function () {
            lspLanguages = PreferencesManager.get("lsp.languages");
            // TODO: this
        });

        lspLanguages.forEach(function (config) {
            var clientHandler = new ClientHandler(config.langs);
            clientHandler.init(config);
        })
    };

    exports.initiateService = initiateService;
});
