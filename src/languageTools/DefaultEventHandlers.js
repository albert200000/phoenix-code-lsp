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

/* eslint-disable indent */
/* eslint no-console: 0*/
define(function (require, exports, module) {
    "use strict";

    var _ = brackets.getModule("thirdparty/lodash"),
        Editor = brackets.getModule("editor/Editor"),
        EditorManager = brackets.getModule("editor/EditorManager");

    var LanguageManager = brackets.getModule("language/LanguageManager"),
        ProjectManager = brackets.getModule("project/ProjectManager"),
        PathConverters = require("./PathConverters");

    function EventPropagationProvider(client) {
        this.client = client;
        this.previousProject = "";
        this.currentProject = ProjectManager.getProjectRoot();
        this.currentHighlights = []; // Track active highlights
    }

    EventPropagationProvider.prototype._sendDocumentOpenNotification = function (languageId, doc) {
        if (!this.client) {
            return;
        }

        if (this.client._languages.includes(languageId)) {
            this.client.notifyTextDocumentOpened({
                languageId: languageId,
                filePath: (doc.file._path || doc.file.fullPath),
                fileContent: doc.getText()
            });
        }
    };

    EventPropagationProvider.prototype.handleActiveEditorChange = function (event, current, previous) {
        var self = this;

        if (!this.client) {
            return;
        }

        if (previous) {
            previous.document
                .off("languageChanged.lsp");
            var previousLanguageId = LanguageManager.getLanguageForPath(previous.document.file.fullPath).getId();
            if (this.client._languages.includes(previousLanguageId)) {
                this.client.notifyTextDocumentClosed({
                    filePath: (previous.document.file._path || previous.document.file.fullPath)
                });
            }
        }

        if (current) {
            var currentLanguageId = LanguageManager.getLanguageForPath(current.document.file.fullPath).getId();
            current.document
                .on("languageChanged.lsp", function () {
                    var languageId = LanguageManager.getLanguageForPath(current.document.file.fullPath).getId();
                    self._sendDocumentOpenNotification(languageId, current.document);
                });
            self._sendDocumentOpenNotification(currentLanguageId, current.document);
        }
    };

    EventPropagationProvider.prototype.handleProjectOpen = function (event, directory) {
        if (!this.client) {
            return;
        }

        this.currentProject = directory.fullPath;

        this.client.notifyProjectRootsChanged({
            foldersAdded: [this.currentProject],
            foldersRemoved: [this.previousProject]
        });
    };

    EventPropagationProvider.prototype.handleProjectClose = function (event, directory) {
        if (!this.client) {
            return;
        }

        this.previousProject = directory.fullPath;
    };

    EventPropagationProvider.prototype.handleDocumentDirty = function (event, doc) {
        if (!this.client) {
            return;
        }

        if (!doc.isDirty) {
            var docLanguageId = LanguageManager.getLanguageForPath(doc.file.fullPath).getId();
            if (this.client._languages.includes(docLanguageId)) {
                this.client.notifyTextDocumentSave({
                    filePath: (doc.file._path || doc.file.fullPath)
                });
            }
        }
    };

    EventPropagationProvider.prototype.handleDocumentChange = function (event, doc, changeList) {
        if (!this.client) {
            return;
        }

        var docLanguageId = LanguageManager.getLanguageForPath(doc.file.fullPath).getId();
        if (this.client._languages.includes(docLanguageId)) {
            this.client.notifyTextDocumentChanged({
                filePath: (doc.file._path || doc.file.fullPath),
                fileContent: doc.getText()
            });
        }
    };

    EventPropagationProvider.prototype.handleDocumentRename = function (event, oldName, newName) {
        if (!this.client) {
            return;
        }

        var oldDocLanguageId = LanguageManager.getLanguageForPath(oldName).getId();
        if (this.client._languages.includes(oldDocLanguageId)) {
            this.client.notifyTextDocumentClosed({
                filePath: oldName
            });
        }

        var newDocLanguageId = LanguageManager.getLanguageForPath(newName).getId();
        if (this.client._languages.includes(newDocLanguageId)) {
            this.client.notifyTextDocumentOpened({
                filePath: newName
            });
        }
    };

    EventPropagationProvider.prototype.handleAppClose = function (_) {
        //Also handles Reload with Extensions
        if (!this.client) {
            return;
        }

        this.client.stop();
    };

    EventPropagationProvider.prototype._clearHighlights = function (editor) {
        if (!editor) {
            return;
        }

        // Clear all existing highlights
        this.currentHighlights.forEach(function (highlight) {
            editor._codeMirror.doc.removeLineClass(highlight.from.line, "background", "lsp-highlight");
        });

        this.currentHighlights = [];
    };

    EventPropagationProvider.prototype.handleCursorActivity = _.debounce(function (_, editor) {
        if (!this.client || !editor) {
            return;
        }

        // Clear previous highlights
        this._clearHighlights(editor);

        // Get the current cursor position
        var cursorPos = editor.getCursorPos();
        var doc = editor.document;
        var filePath = doc.file._path || doc.file.fullPath;
        var languageId = LanguageManager.getLanguageForPath(filePath).getId();

        if (!this.client._languages.includes(languageId)) {
            return;
        }

        this.client.requestDocumentHighlight({
            filePath: filePath,
            cursorPos: cursorPos
        }).then(function (results) {
            if (results && results.length > 0) {
                var self = this;
                // Convert LSP ranges to CodeMirror format and mark them
                results.forEach(function (highlight) {
                    var from = {
                        line: highlight.range.start.line,
                        ch: highlight.range.start.character
                    };
                    var to = {
                        line: highlight.range.end.line,
                        ch: highlight.range.end.character
                    };

                    // Store the highlight range for later cleanup
                    self.currentHighlights.push({ from: from, to: to });

                    // Apply highlight using CodeMirror's line class
                    for (var line = from.line; line <= to.line; line++) {
                        // TODO: fix this
                        editor._codeMirror.doc.addLineClass(line, "background", "lsp-highlight");
                    }
                }.bind(this));
            }
        }.bind(this));
    }, 250);

    function handleProjectFoldersRequest(event) {
        var projectRoot = ProjectManager.getProjectRoot(),
            workspaceFolders = [projectRoot];

        workspaceFolders = PathConverters.convertToWorkspaceFolders(workspaceFolders);

        return $.Deferred().resolve(workspaceFolders);
    };

    EventPropagationProvider.prototype.registerClientForEditorEvent = function () {
        if (this.client) {
            var handleActiveEditorChange = this.handleActiveEditorChange.bind(this),
                handleProjectOpen = this.handleProjectOpen.bind(this),
                handleProjectClose = this.handleProjectClose.bind(this),
                handleDocumentDirty = this.handleDocumentDirty.bind(this),
                handleDocumentChange = this.handleDocumentChange.bind(this),
                handleDocumentRename = this.handleDocumentRename.bind(this),
                handleAppClose = this.handleAppClose.bind(this),
                handleCursorActivity = this.handleCursorActivity.bind(this);

            this.client.addOnEditorChangeHandler(handleActiveEditorChange);
            this.client.addOnProjectOpenHandler(handleProjectOpen);
            this.client.addBeforeProjectCloseHandler(handleProjectClose);
            this.client.addOnDocumentDirtyFlagChangeHandler(handleDocumentDirty);
            this.client.addOnDocumentChangeHandler(handleDocumentChange);
            this.client.addOnFileRenameHandler(handleDocumentRename);
            this.client.addBeforeAppClose(handleAppClose);
            this.client.onProjectFoldersRequest(handleProjectFoldersRequest);
            this.client.addOnCursorActivityHandler(handleCursorActivity);
        } else {
            console.log("No client provided for event propagation");
        }
    };

    exports.EventPropagationProvider = EventPropagationProvider;
});
