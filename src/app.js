/* global alert, confirm, prompt, Option, Worker */

var $ = require('jquery');
var semver = require('semver');

var utils = require('./app/utils');
var QueryParams = require('./app/query-params');
var queryParams = new QueryParams();
var GistHandler = require('./app/gist-handler');
var gistHandler = new GistHandler();

var Storage = require('./app/storage');
var Editor = require('./app/editor');
var Renderer = require('./app/renderer');
var Compiler = require('./app/compiler');
var ExecutionContext = require('./app/execution-context');
var UniversalDApp = require('./universal-dapp.js');
var Debugger = require('./app/debugger');
var FormalVerification = require('./app/formalVerification');
var EventManager = require('./lib/eventManager');
// The event listener needs to be registered as early as possible, because the
// parent will send the message upon the "load" event.
var filesToLoad = null;
var loadFilesCallback = function (files) { filesToLoad = files; }; // will be replaced later
window.addEventListener('message', function (ev) {
  if (typeof ev.data === typeof [] && ev.data[0] === 'loadFiles') {
    loadFilesCallback(ev.data[1]);
  }
}, false);
/*
  trigger tabChanged
*/
var run = function () {
  var self = this;
  this.event = new EventManager();
  var storage = new Storage(updateFiles);

  function loadFiles (files) {
    for (var f in files) {
      var key = utils.fileKey(f);
      var content = files[f].content;
      storage.loadFile(key, content);
    }
    editor.setCacheFile(utils.fileKey(Object.keys(files)[0]));
    updateFiles();
  }

  loadFilesCallback = function (files) {
    loadFiles(files);
  };

  if (filesToLoad !== null) {
    loadFiles(filesToLoad);
  }

  // ------------------ query params (hash) ----------------

  function syncQueryParams () {
    $('#optimize').attr('checked', (queryParams.get().optimize === 'true'));
  }

  window.onhashchange = syncQueryParams;
  syncQueryParams();

  // -------- check file upload capabilities -------

  if (!(window.File || window.FileReader || window.FileList || window.Blob)) {
    $('.uploadFile').remove();
  }

  // ------------------ gist load ----------------

  var loadingFromGist = gistHandler.handleLoad(queryParams.get(), function (gistId) {
    $.ajax({
      url: 'https://api.github.com/gists/' + gistId,
      jsonp: 'callback',
      dataType: 'jsonp',
      success: function (response) {
        if (response.data) {
          if (!response.data.files) {
            alert('Gist load error: ' + response.data.message);
            return;
          }
          loadFiles(response.data.files);
        }
      }
    });
  });

  // ----------------- storage sync --------------------

  window.syncStorage = storage.sync;
  storage.sync();

  // ----------------- editor ----------------------

  var editor = new Editor(loadingFromGist, storage);

  // ----------------- tabbed menu -------------------
  $('#options li').click(function (ev) {
    var $el = $(this);
    selectTab($el);
  });
  var selectTab = function (el) {
    var match = /[a-z]+View/.exec(el.get(0).className);
    if (!match) return;
    var cls = match[0];
    if (!el.hasClass('active')) {
      el.parent().find('li').removeClass('active');
      $('#optionViews').attr('class', '').addClass(cls);
      el.addClass('active');
    }
    self.event.trigger('tabChanged', [cls]);
  };

  // ------------------ gist publish --------------

  $('#gist').click(function () {
    if (confirm('Are you sure you want to publish all your files anonymously as a public gist on github.com?')) {
      var files = editor.packageFiles();
      var description = 'Created using browser-solidity: Realtime Ethereum Contract Compiler and Runtime. \n Load this file by pasting this gists URL or ID at https://ethereum.github.io/browser-solidity/#version=' + queryParams.get().version + '&optimize=' + queryParams.get().optimize + '&gist=';

      $.ajax({
        url: 'https://api.github.com/gists',
        type: 'POST',
        data: JSON.stringify({
          description: description,
          public: true,
          files: files
        })
      }).done(function (response) {
        if (response.html_url && confirm('Created a gist at ' + response.html_url + ' Would you like to open it in a new window?')) {
          window.open(response.html_url, '_blank');
        }
      });
    }
  });

  $('#copyOver').click(function () {
    var target = prompt(
      'To which other browser-solidity instance do you want to copy over all files?',
      'https://ethereum.github.io/browser-solidity/'
    );
    if (target === null) {
      return;
    }
    var files = editor.packageFiles();
    $('<iframe/>', {src: target, style: 'display:none;', load: function () {
      this.contentWindow.postMessage(['loadFiles', files], '*');
    }}).appendTo('body');
  });

  // ----------------- file selector-------------

  var $filesEl = $('#files');
  var FILE_SCROLL_DELTA = 300;

  $('.newFile').on('click', function () {
    editor.newFile();
    updateFiles();

    $filesEl.animate({ left: Math.max((0 - activeFilePos() + (FILE_SCROLL_DELTA / 2)), 0) + 'px' }, 'slow', function () {
      reAdjust();
    });
  });

  // ----------------- file upload -------------

  $('.inputFile').on('change', function () {
    var fileList = $('input.inputFile')[0].files;
    for (var i = 0; i < fileList.length; i++) {
      var name = fileList[i].name;
      if (!storage.exists(utils.fileKey(name)) || confirm('The file ' + name + ' already exists! Would you like to overwrite it?')) {
        editor.uploadFile(fileList[i], updateFiles);
      }
    }

    $filesEl.animate({ left: Math.max((0 - activeFilePos() + (FILE_SCROLL_DELTA / 2)), 0) + 'px' }, 'slow', function () {
      reAdjust();
    });
  });

  $filesEl.on('click', '.file:not(.active)', showFileHandler);

  $filesEl.on('click', '.file.active', function (ev) {
    var $fileTabEl = $(this);
    var originalName = $fileTabEl.find('.name').text();
    ev.preventDefault();
    if ($(this).find('input').length > 0) return false;
    var $fileNameInputEl = $('<input value="' + originalName + '"/>');
    $fileTabEl.html($fileNameInputEl);
    $fileNameInputEl.focus();
    $fileNameInputEl.select();
    $fileNameInputEl.on('blur', handleRename);
    $fileNameInputEl.keyup(handleRename);

    function handleRename (ev) {
      ev.preventDefault();
      if (ev.which && ev.which !== 13) return false;
      var newName = ev.target.value;
      $fileNameInputEl.off('blur');
      $fileNameInputEl.off('keyup');

      if (newName !== originalName && confirm(
          storage.exists(utils.fileKey(newName))
            ? 'Are you sure you want to overwrite: ' + newName + ' with ' + originalName + '?'
            : 'Are you sure you want to rename: ' + originalName + ' to ' + newName + '?')) {
        storage.rename(utils.fileKey(originalName), utils.fileKey(newName));
        editor.renameSession(utils.fileKey(originalName), utils.fileKey(newName));
        editor.setCacheFile(utils.fileKey(newName));
      }

      updateFiles();
      return false;
    }

    return false;
  });

  $filesEl.on('click', '.file .remove', function (ev) {
    ev.preventDefault();
    var name = $(this).parent().find('.name').text();

    if (confirm('Are you sure you want to remove: ' + name + ' from local storage?')) {
      storage.remove(utils.fileKey(name));
      editor.removeSession(utils.fileKey(name));
      editor.setNextFile(utils.fileKey(name));
      updateFiles();
    }
    return false;
  });

  function swicthToFile (file) {
    editor.setCacheFile(utils.fileKey(file));
    updateFiles();
  }

  function showFileHandler (ev) {
    ev.preventDefault();
    swicthToFile($(this).find('.name').text());
    return false;
  }

  function activeFileTab () {
    var name = utils.fileNameFromKey(editor.getCacheFile());
    return $('#files .file').filter(function () { return $(this).find('.name').text() === name; });
  }

  function updateFiles () {
    var $filesEl = $('#files');
    var files = editor.getFiles();

    $filesEl.find('.file').remove();
    $('#output').empty();

    for (var f in files) {
      $filesEl.append(fileTabTemplate(files[f]));
    }

    if (editor.cacheFileIsPresent()) {
      var active = activeFileTab();
      active.addClass('active');
      editor.resetSession();
    }
    $('#input').toggle(editor.cacheFileIsPresent());
    $('#output').toggle(editor.cacheFileIsPresent());
    reAdjust();
  }

  function fileTabTemplate (key) {
    var name = utils.fileNameFromKey(key);
    return $('<li class="file"><span class="name">' + name + '</span><span class="remove"><i class="fa fa-close"></i></span></li>');
  }

  var $filesWrapper = $('.files-wrapper');
  var $scrollerRight = $('.scroller-right');
  var $scrollerLeft = $('.scroller-left');

  function widthOfList () {
    var itemsWidth = 0;
    $('.file').each(function () {
      var itemWidth = $(this).outerWidth();
      itemsWidth += itemWidth;
    });
    return itemsWidth;
  }

  //  function widthOfHidden () {
  //    return ($filesWrapper.outerWidth() - widthOfList() - getLeftPosi())
  //  }

  function widthOfVisible () {
    return $filesWrapper.outerWidth();
  }

  function getLeftPosi () {
    return $filesEl.position().left;
  }

  function activeFilePos () {
    var el = $filesEl.find('.active');
    var l = el.position().left;
    return l;
  }

  function reAdjust () {
    if (widthOfList() + getLeftPosi() > widthOfVisible()) {
      $scrollerRight.fadeIn('fast');
    } else {
      $scrollerRight.fadeOut('fast');
    }

    if (getLeftPosi() < 0) {
      $scrollerLeft.fadeIn('fast');
    } else {
      $scrollerLeft.fadeOut('fast');
      $filesEl.animate({ left: getLeftPosi() + 'px' }, 'slow');
    }
  }

  $scrollerRight.click(function () {
    var delta = (getLeftPosi() - FILE_SCROLL_DELTA);
    $filesEl.animate({ left: delta + 'px' }, 'slow', function () {
      reAdjust();
    });
  });

  $scrollerLeft.click(function () {
    var delta = Math.min((getLeftPosi() + FILE_SCROLL_DELTA), 0);
    $filesEl.animate({ left: delta + 'px' }, 'slow', function () {
      reAdjust();
    });
  });

  updateFiles();

  // ----------------- resizeable ui ---------------

  var dragging = false;
  $('#dragbar').mousedown(function (e) {
    e.preventDefault();
    dragging = true;
    var main = $('#righthand-panel');
    var ghostbar = $('<div id="ghostbar">', {
      css: {
        top: main.offset().top,
        left: main.offset().left
      }
    }).prependTo('body');

    $(document).mousemove(function (e) {
      ghostbar.css('left', e.pageX + 2);
    });
  });

  var $body = $('body');

  function setEditorSize (delta) {
    $('#righthand-panel').css('width', delta);
    $('#editor').css('right', delta);
    onResize();
  }

  function getEditorSize () {
    storage.setEditorSize($('#righthand-panel').width());
  }

  $(document).mouseup(function (e) {
    if (dragging) {
      var delta = $body.width() - e.pageX + 2;
      $('#ghostbar').remove();
      $(document).unbind('mousemove');
      dragging = false;
      setEditorSize(delta);
      storage.setEditorSize(delta);
      reAdjust();
    }
  });

  // set cached defaults
  var cachedSize = storage.getEditorSize();
  if (cachedSize) setEditorSize(cachedSize);
  else getEditorSize();

  // ----------------- toggle right hand panel -----------------

  var hidingRHP = false;
  $('.toggleRHP').click(function () {
    hidingRHP = !hidingRHP;
    setEditorSize(hidingRHP ? 0 : storage.getEditorSize());
    $('.toggleRHP i').toggleClass('fa-angle-double-right', !hidingRHP);
    $('.toggleRHP i').toggleClass('fa-angle-double-left', hidingRHP);
  });

  // ----------------- editor resize ---------------

  function onResize () {
    editor.resize();
    reAdjust();
  }
  window.onresize = onResize;
  onResize();

  document.querySelector('#editor').addEventListener('change', onResize);
  document.querySelector('#editorWrap').addEventListener('change', onResize);

  // ----------------- compiler output renderer ----------------------

  $('.asmOutput button').click(function () { $(this).parent().find('pre').toggle(); });

  // ----------------- compiler ----------------------

  function handleGithubCall (root, path, cb) {
    $('#output').append($('<div/>').append($('<pre/>').text('Loading github.com/' + root + '/' + path + ' ...')));
    return $.getJSON('https://api.github.com/repos/' + root + '/contents/' + path, cb);
  }

  var executionContext = new ExecutionContext();
  var compiler = new Compiler(editor, handleGithubCall);
  var formalVerification = new FormalVerification($('#verificationView'), compiler.event);

  var transactionDebugger = new Debugger('#debugger', editor, compiler, executionContext.event, swicthToFile);
  transactionDebugger.addProvider('vm', executionContext.vm());
  transactionDebugger.switchProvider('vm');
  transactionDebugger.addProvider('injected', executionContext.web3());
  transactionDebugger.addProvider('web3', executionContext.web3());

  var udapp = new UniversalDApp(executionContext, {
    removable: false,
    removable_instances: true
  }, transactionDebugger);

  udapp.event.register('debugRequested', this, function (txResult) {
    startdebugging(txResult.transactionHash);
  });

  var renderer = new Renderer(editor, executionContext.web3(), updateFiles, udapp, executionContext, formalVerification.event, compiler.event); // eslint-disable-line

  var autoCompile = document.querySelector('#autoCompile').checked;

  document.querySelector('#autoCompile').addEventListener('change', function () {
    autoCompile = document.querySelector('#autoCompile').checked;
  });

  var previousInput = '';
  var compileTimeout = null;

  function editorOnChange () {
    var input = editor.getValue();
    if (input === '') {
      editor.setCacheFileContent('');
      return;
    }
    if (input === previousInput) {
      return;
    }
    previousInput = input;

    if (!autoCompile) {
      return;
    }

    if (compileTimeout) {
      window.clearTimeout(compileTimeout);
    }
    compileTimeout = window.setTimeout(compiler.compile, 300);
  }

  editor.onChangeSetup(editorOnChange);

  $('#compile').click(function () {
    compiler.compile();
  });

  executionContext.event.register('contextChanged', this, function (context) {
    compiler.compile();
  });

  executionContext.event.register('web3EndpointChanged', this, function (context) {
    compiler.compile();
  });

  compiler.event.register('loadingCompiler', this, function (url, usingWorker) {
    setVersionText(usingWorker ? '(loading using worker)' : '(loading)');
  });

  compiler.event.register('compilerLoaded', this, function (version) {
    previousInput = '';
    setVersionText(version);
    compiler.compile();
    initWithQueryParams();
  });

  function initWithQueryParams () {
    if (queryParams.get().endpointurl) {
      executionContext.setEndPointUrl(queryParams.get().endpointurl);
    }
    if (queryParams.get().context) {
      executionContext.setContext(queryParams.get().context);
    }
    if (queryParams.get().debugtx) {
      startdebugging(queryParams.get().debugtx);
    }
  }

  function startdebugging (txHash) {
    transactionDebugger.debug(txHash);
    selectTab($('ul#options li.debugView'));
  }

  function setVersionText (text) {
    $('#version').text(text);
  }

  function loadVersion (version) {
    queryParams.update({version: version});
    var url;
    if (version === 'builtin') {
      url = 'soljson.js';
    } else {
      url = 'https://ethereum.github.io/solc-bin/bin/' + version;
    }
    var isFirefox = typeof InstallTrigger !== 'undefined';
    if (document.location.protocol !== 'file:' && Worker !== undefined && isFirefox) {
      // Workers cannot load js on "file:"-URLs and we get a
      // "Uncaught RangeError: Maximum call stack size exceeded" error on Chromium,
      // resort to non-worker version in that case.
      compiler.loadVersion(true, url);
    } else {
      compiler.loadVersion(false, url);
    }
  }

  compiler.setOptimize(document.querySelector('#optimize').checked);

  document.querySelector('#optimize').addEventListener('change', function () {
    var optimize = document.querySelector('#optimize').checked;
    queryParams.update({ optimize: optimize });
    compiler.setOptimize(optimize);
    compiler.compile();
  });

  // ----------------- version selector-------------

  // clear and disable the version selector
  $('option', '#versionSelector').remove();
  $('#versionSelector').attr('disabled', true);

  // load the new version upon change
  $('#versionSelector').change(function () {
    loadVersion($('#versionSelector').val());
  });

  $.getJSON('https://ethereum.github.io/solc-bin/bin/list.json', function (data, status) {
    // loading failed for some reason, fall back to local compiler
    if (status !== 'success') {
      $('#versionSelector').append(new Option('latest local version', 'builtin'));

      loadVersion('builtin');
      return;
    }

    function buildVersion (build) {
      if (build.prerelease && build.prerelease.length > 0) {
        return build.version + '-' + build.prerelease;
      } else {
        return build.version;
      }
    }

    // Sort builds according to semver
    var builds = data.builds.sort(function (a, b) {
      // NOTE: b vs. a (the order is important), because we want latest first in the list
      return semver.compare(buildVersion(b), buildVersion(a));
    });

    // populate version dropdown with all available compiler versions
    $.each(builds, function (i, build) {
      $('#versionSelector').append(new Option(buildVersion(build), build.path));
    });

    $('#versionSelector').attr('disabled', false);

    // always include the local version
    $('#versionSelector').append(new Option('latest local version', 'builtin'));

    // find latest release
    var selectedVersion = null;
    for (var release in data.releases) {
      if (selectedVersion === null || semver.gt(release, selectedVersion)) {
        selectedVersion = release;
      }
    }
    if (selectedVersion !== null) {
      selectedVersion = data.releases[selectedVersion];
    }

    // override with the requested version
    if (queryParams.get().version) {
      selectedVersion = queryParams.get().version;
    }

    loadVersion(selectedVersion);
  });

  storage.sync();
};

module.exports = {
  'run': run
};
