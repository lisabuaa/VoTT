const remote = require('electron').remote;
const basepath = remote.app.getAppPath();
const dialog = remote.require('electron').dialog;
const path = require('path');
const fs = require('fs');
const DetectionExtension = require('./lib/videotagging_extensions').Detection;
const ipcRenderer = require('electron').ipcRenderer;
const testSetSize = .20;
const {clipboard} = require('electron');
const tfrecord = require('tfrecord');

var trackingEnabled = true;
var saveState,
    visitedFrames, //keep track of the visited frames
    visitedFramesNumber,
    videotagging,
    detection,
    trackingExtension,
    assetFolder; 

$(document).ready(() => {//init confirm keys figure out why this doesn't work
  $('#inputtags').tagsinput({confirmKeys: [13, 32, 44, 45, 46, 59, 188]});
});

//ipc rendering
ipcRenderer.on('openVideo', (event, message) => {
  fileSelected();
});

ipcRenderer.on('openImageDirectory', (event, message) => {
  folderSelected();
});

ipcRenderer.on('openRecordDirectory', (event, message) => {
  recordFolderSelected();
});

ipcRenderer.on('export-records', (event, message) => {
  if(videotagging.imagelist && visitedFrames.length > 0){
    for (let i = 0; i < visitedFrames; i++) {
      if(videotagging.recordlist){

      }
      writeRecord(videotagging.imagelist[i],videotagging.recordlist[i]).then(()=>{
        console.log(`record #: ${i}/${videotagging.recordlist.length} saved`)
      });
    }
  }
});

ipcRenderer.on('saveVideo', (event, message) => {
  save();
  let notification = new Notification('Offline Video Tagger', {
   body: 'Successfully saved metadata in ' + `${videotagging.src}.json`
  });
});

ipcRenderer.on('help', (event, message) => {
  var args = {
    type : "help"
  };
   ipcRenderer.send('show-popup', args);
});

ipcRenderer.on('filter', (event, message) => {
    var filter = message;

    if (videotagging !== null) { 
      videotagging.addFilterByName(filter);
    }    
});

ipcRenderer.on('export', (event, message) => {
   var args = {
     type : "export",
     supportedFormats : detection.detectionAlgorithmManager.getAvailbleExporters(),
     assetFolder : assetFolder
   };

   ipcRenderer.send('show-popup', args);
});

ipcRenderer.on('export-tags', (event, exportConfig) => {
  addLoader();
  detection.export(videotagging.imagelist, exportConfig.exportFormat, exportConfig.exportUntil, exportConfig.exportPath, testSetSize, () => {
     if(!videotagging.imagelist){
       videotagging.video.oncanplay = updateVisitedFrames;
      } 
     $(".loader").remove();
  });
});

ipcRenderer.on('review', (event, message) => {
    var args = {
      type: 'review',
      supportedFormats : detection.detectionAlgorithmManager.getAvailbleReviewers(),
      assetFolder : assetFolder
    };
    ipcRenderer.send('show-popup', args);
});

ipcRenderer.on('reviewEndpoint', (event, message) => {
  var args = {
    type: 'review-endpoint',
  };
  ipcRenderer.send('show-popup', args);
});

ipcRenderer.on('review-model', (event, reviewModelConfig) => {
  var modelLocation = reviewModelConfig.modelPath;
  if (fs.existsSync(modelLocation)) {
    addLoader();
    var colors_back = videotagging.optionalTags.colors;
    videotagging.optionalTags.colors = null;

    detection.review(videotagging.imagelist, reviewModelConfig.modelFormat, modelLocation, reviewModelConfig.output, (err) => {
        if (err){
          alert(`An error occured with Local Active Learning \n Please check the debug console for more information.`);
          videotagging.optionalTags.colors = colors_back;
        }
        if(!videotagging.imagelist){
          videotagging.video.oncanplay = updateVisitedFrames;
        }      
        $(".loader").remove();        
    });
  }
  else {
      alert(`No model found! Please make sure you put your model in the following directory: ${modelLocation}`)
  }
      
});

ipcRenderer.on('review-model-endpoint', (event, reviewModelConfig) => {
    addLoader();
    detection.reviewEndpoint( videotagging.imagelist, reviewModelConfig.endpoint, (err) => {
      if (err){
        alert(`An error occured with Remote Active Learning \n Please check the debug console for more information.`);
      }
      if(!videotagging.imagelist){
        videotagging.video.oncanplay = updateVisitedFrames;
      }      
      $(".loader").remove();        
    });    
});


ipcRenderer.on('toggleTracking', (event, message) => {
  if (trackingEnabled) {
    trackingExtension.stopTracking();
  } else {
    trackingExtension.startTracking();
  } 
  trackingEnabled = !trackingEnabled;

});

//drag and drop support
document.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files[0].type == "video/mp4") {
      fileSelected(e.dataTransfer.files[0]);
    }
    $("#vidImage").attr('src', './public/images/Load-Video.png');
    return false;
});

document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0].type == "video/mp4") {
      e.dataTransfer.dropEffect = "copy";
      $("#vidImage").attr('src', './public/images/Load-Video-Active.png');

    }
    e.stopPropagation();
});

document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    $("#vidImage").attr('src', './public/images/Load-Video.png');
    e.stopPropagation();
});

document.addEventListener('dragstart', (e) => {
    e.preventDefault();
    let file = e.dataTransfer.files[0];
    if (file && file.type == "video/mp4") {
        e.dataTransfer.effectAllowed = "copy";
    }
    e.stopPropagation();
});

// stop zooming
document.addEventListener('mousewheel', (e) => {
  if(e.ctrlKey) {
    e.preventDefault();
  }
});

window.addEventListener('keydown', (e) => {
  if(e.shiftKey && videotagging){
    videotagging.multiselection = true;
  }
});

window.addEventListener('keyup', (e) => {
  if(videotagging){
    if(!e.shiftKey){
      videotagging.multiselection = false;
    }
  
    var selectedRegions = videotagging.getSelectedRegions();
    
    if(e.ctrlKey && (e.code == 'KeyC' || e.code == 'KeyX' || e.code == 'KeyA')){

      var widthRatio = videotagging.overlay.width / videotagging.sourceWidth;
      var heightRatio = videotagging.overlay.height / videotagging.sourceHeight;
      var content = [];
      
      if(e.code == 'KeyA'){ //select all
        videotagging.selectAllRegions();
        selectedRegions = videotagging.getSelectedRegions();
      }

      for(let currentRegion of selectedRegions){
        content.push(
          {
            x1: currentRegion.x1 * widthRatio,
            y1: currentRegion.y1 * heightRatio,
            x2: currentRegion.x2 * widthRatio,
            y2: currentRegion.y2 * heightRatio,
            tags: currentRegion.tags
          }
        )

        if(e.code == 'KeyX'){ //cut 
          videotagging.deleteRegionById(currentRegion.UID);
          videotagging.showAllRegions();
        }
      }

      clipboard.writeText(JSON.stringify(content));
    } 
    if(e.shiftKey && e.code == 'Delete') {
      e.stopPropagation();
      deleteFrame()
    }
  }
  if(e.ctrlKey && e.code == 'KeyV'){ //paste
    try{
      var content = JSON.parse(clipboard.readText());

      for(let currentRegion of content){
        videotagging.createRegion(currentRegion.x1, currentRegion.y1, currentRegion.x2, currentRegion.y2);
        videotagging.addTagsToRegion(currentRegion.tags);
      }
    }catch(error) {
      console.log('ERROR: No bounding box in clipboard')
    }
  }
}, true); 

//adds a loading animation to the tagger
function addLoader() {
  if(!$('.loader').length) {
    $("<div class=\"loader\"></div>").appendTo($("#videoWrapper"));
  }
}

//managed the visited frames
function updateVisitedFrames(){
  if(videotagging.imagelist){
    visitedFrames.add(videotagging.imagelist[videotagging.imageIndex].split("\\").pop());
    visitedFramesNumber.add(videotagging.imageIndex);
  } else {
    visitedFrames.add(videotagging.getCurrentFrameId());
  }
}

function checkPointRegion() {
  if ($('#regiontype').val() != "Point") {
    $('#regionPointGroup').hide();
  } else {
    $('#regionPointGroup').show();
  }
}

//load logic
function fileSelected(filepath) {
   $('#load-message-container').hide();

  if (filepath) {  //checking if a video is dropped
    let pathName = filepath.path;
    openPath(pathName, false);
  } else { // showing system open dialog
    dialog.showOpenDialog({
      filters: [{ name: 'Videos', extensions: ['mp4','ogg']}],
      properties: ['openFile']
    },
    function (pathName) {
      if (pathName) openPath(pathName[0], false);
      else $('#load-message-container').show();
    });
  }

}

function folderSelected(folderpath) {
   $('#load-message-container').hide();
   dialog.showOpenDialog({
      filters: [{ name: 'Image Directory'}],
      properties: ['openDirectory']
    },function (pathName) {
      if (pathName) openPath(pathName[0], true);
      else $('#load-message-container').show();
    });

}

function recordFolderSelected(recordfolderpath){
  $('#load-message-container').hide();
  dialog.showOpenDialog({
    filters: [{ name: 'tfRecord Directory'}],
    properties: ['openDirectory']
  },function (pathName) {
    if (pathName) openPath(pathName[0], true, true);
    else $('#load-message-container').show();
  });
}

function openPath(pathName, isDir, isRecords = false) {
    // show configuration
    $('#load-message-container').hide();
    $('#video-tagging-container').hide();
    $('#load-form-container').show();
    $('#framerateGroup').show();
    
    //set title indicator
    $('title').text(`Tagging Job Configuration: ${path.basename(pathName, path.extname(pathName))}`);
    $('#inputtags').tagsinput('removeAll');//remove all previous tag labels

    if (isDir) {
      $('#framerateGroup').hide();
      $('#suggestGroup').hide();
    } else {
      $('#framerateGroup').show();
      $('#suggestGroup').show();
    }

    assetFolder = path.join(path.dirname(pathName), `${path.basename(pathName, path.extname(pathName))}_output`);
    
    try {
      var config = require(`${pathName}.json`);
      saveState = JSON.stringify(config);
      //restore config
      $('#inputtags').val(config.inputTags);
      config.inputTags.split(",").forEach( tag => {
          $("#inputtags").tagsinput('add',tag);
      });
      if (config.framerate){
         $("#framerate").val(config.framerate);
      }
      if (config.suggestiontype){
        $('#suggestiontype').val(config.suggestiontype);
      }
      if (config.scd){
        document.getElementById("scd").checked = config.scd;
      }
      
    } catch (e) {
      console.log(`Error loading save file ${e.message}`);
    }

    document.getElementById('loadButton').onclick = loadTagger;
    
    async function loadTagger (e) {
      if(framerate.validity.valid && inputtags.validity.valid) {
        $('.bootstrap-tagsinput').last().removeClass( "invalid" );
             
        videotagging = document.getElementById('video-tagging'); //find out why jquery doesn't play nice with polymer
        videotagging.regiontype = $('#regiontype').val();
        videotagging.multiregions = 1;
        videotagging.regionsize = $('#regionsize').val();
        videotagging.inputtagsarray = $('#inputtags').val().replace(/\s/g,'').split(',');
        videotagging.video.currentTime = 0;
        videotagging.framerate = $('#framerate').val();
        videotagging.src = ''; // ensures reload if user opens same video 

        if (config) {  
          if (config.tag_colors){
            videotagging.optionalTags.colors = config.tag_colors;
          }
          videotagging.inputframes = config.frames;
          visitedFrames =  new Set(config.visitedFrames);
          visitedFramesNumber =  new Set(Array.from(Array(visitedFrames).keys()));
        } else {
          videotagging.inputframes = {};
          visitedFrames = new Set();
          if(isDir){
            var files = fs.readdirSync(pathName);
            
            videotagging.imagelist = files.filter(function(file){
                  return file.match(/.(jpg|jpeg|png|gif)$/i);
            });
            console.log(videotagging.imagelist[0])
            visitedFrames = new Set([videotagging.imagelist[0]]);
            visitedFramesNumber =  new Set([0])
          } else {
            visitedFrames = new Set();
            visitedFramesNumber =  new Set()
          }
          // visitedFrames =  (isDir) ? new Set([pathName]) : new Set();
        } 

        if (isDir){
            $('title').text(`Image Tagging Job: ${path.dirname(pathName)}`); //set title indicator
            if(isRecords) $('title').text(`Image Tagging from Records Job: ${path.dirname(pathName)}`); //set title indicator

            //get list of images in directory
            var files = fs.readdirSync(pathName);
            
            if(isRecords){
              videotagging.imagelist = files.filter(function(file){
                return file.match(/.(tfrecord)$/i);
              });
              let recordlist = videotagging.imagelist.map(async record => {
                const resp = await readRecord(pathName,record);
                return resp;
              })
              videotagging.recordlist = await Promise.all(recordlist);
              videotagging.currTFRecord = videotagging.recordlist[0];
              // getRegionsFromRecord(videotagging.recordlist[0]);
            }else{
              videotagging.imagelist = files.filter(function(file){
                return file.match(/.(jpg|jpeg|png|gif)$/i);
              });
            }

            if (videotagging.imagelist.length){
              //Check if tagging was done in previous version of VOTT
              console.log(Array.from(visitedFrames));
              if(!isNaN(Array.from(visitedFrames)[0])){
                visitedFramesNumber = visitedFrames;
                visitedFrames = new Set(Array.from(visitedFramesNumber).map(frame => videotagging.imagelist[parseInt(frame)]))
                
                //Replace the keys of the frames object
                Object.keys(videotagging.inputframes).map(function(key, index) {
                  videotagging.inputframes[videotagging.imagelist[key].split("\\").pop()] = videotagging.inputframes[key];
                  delete videotagging.inputframes[key];
                }, this);
              }

              videotagging.imagelist = videotagging.imagelist.map((filepath) => {return path.join(pathName,filepath)});
              videotagging.src = pathName; 
              //track visited frames
              $("#video-tagging").off("stepFwdClicked-AfterStep", updateVisitedFrames);
              // $("#video-tagging").on("stepFwdClicked-AfterStep", updateVisitedFrames);
              $("#video-tagging").on("stepFwdClicked-AfterStep", () => {
                //update title to match src
                if(videotagging.currTFRecord) {
                  // console.log(videotagging.currTFRecord)
                  if(!visitedFrames.has(videotagging.getCurrentFrameId())) {getRegionsFromRecord(videotagging.currTFRecord); console.log('adding')}
                  $('title').text(`Image Tagging from Records Job: ${path.basename(videotagging.imagelist[videotagging.imageIndex])}`);
                  // getRegionsFromRecord(videotagging.recordlist[0]);
                } else $('title').text(`Image Tagging Job: ${path.basename(videotagging.curImg.src)}`);

                updateVisitedFrames();
              });
              $("#video-tagging").on("stepBwdClicked-AfterStep", () => {
                //update title to match src
                if(videotagging.currTFRecord) {
                  // console.log(videotagging.currTFRecord)
                  if(!visitedFrames.has(videotagging.getCurrentFrameId())) getRegionsFromRecord(videotagging.currTFRecord);
                  $('title').text(`Image Tagging from Records Job: ${path.basename(videotagging.imagelist[videotagging.imageIndex])}`);
                }
                else $('title').text(`Image Tagging Job: ${path.basename(videotagging.curImg.src)}`);

            });


              //auto-save 
              $("#video-tagging").off("stepFwdClicked-BeforeStep");
              $("#video-tagging").on("stepFwdClicked-BeforeStep", save);

              $("#video-tagging").off("stepBwdClicked-BeforeStep");
              $("#video-tagging").on("stepBwdClicked-BeforeStep", save);
              
            } else {
              alert("No images were in the selected directory. Please choose an Image directory.");
                return folderSelected();
            }
        } else {
          $('title').text(`Video Tagging Job: ${path.basename(pathName, path.extname(pathName))}`); //set title indicator
          videotagging.disableImageDir();
          videotagging.src = pathName;
          //set start time
          videotagging.video.oncanplay = function (){
              videotagging.videoStartTime = videotagging.video.currentTime;
              videotagging.video.oncanplay = undefined;
          }
          //init region tracking
          trackingExtension = new VideoTaggingTrackingExtension({
              videotagging: videotagging, 
              trackingFrameRate: 15,
              method: $('#suggestiontype').val(),
              enableRegionChangeDetection: document.getElementById("scd").checked,
              enableSceneChangeDetection: document.getElementById("scd").checked,
              saveHandler: save
          });
          videotagging.video.oncanplay = updateVisitedFrames; 
          //track visited frames
          trackingExtension.startTracking();
        }

        //init detection
        detection = new DetectionExtension(videotagging, visitedFramesNumber);
        
        $('#load-form-container').hide();
        $('#video-tagging-container').show();

        ipcRenderer.send('setFilePath', pathName);
      } else {
        $('.bootstrap-tagsinput').last().addClass( "invalid" );
      }
    }
}

function getRegionsFromRecord(tfRecord){
  let sourceHeight = tfRecord.features.feature['image/height'].int64List.value[0]
  let sourceWidth = tfRecord.features.feature['image/width'].int64List.value[0]

  for (let i = 0; i < tfRecord.features.feature['image/object/bbox/xmin'].floatList.value.length; i++) {
    
    let x1 = tfRecord.features.feature['image/object/bbox/xmin'].floatList.value[i] * sourceWidth;
    let y1 = tfRecord.features.feature['image/object/bbox/ymin'].floatList.value[i] * sourceHeight;
    let x2 = tfRecord.features.feature['image/object/bbox/xmax'].floatList.value[i] * sourceWidth;
    let y2 = tfRecord.features.feature['image/object/bbox/ymax'].floatList.value[i] * sourceHeight;
    videotagging.createRegion(x1,y1,x2,y2)
    // console.log(`regular: ${JSON.stringify(tfRecord)}`)
    console.log(`decoded: ${decode_Uint8(tfRecord.features.feature['image/object/class/text'].bytesList.value[i])}`)
    videotagging.addTagsToRegion([decode_Uint8(tfRecord.features.feature['image/object/class/text'].bytesList.value[i])]);
  }
}

async function writeRecord(recordPath, example = null, id = null) {
  if(!example){
    if(id){
      const regions = videotagging.getRegions(id);
      const builder = tfrecord.createBuilder();

      let xmin = [];
      let ymin = [];
      let xmax = [];
      let ymax = [];
      let tags = [];
      // console.log(`regions: ${JSON.stringify(regions)}`);
      regions.forEach(region => {
        xmin.push(region.x1)
        ymin.push(region.y1)
        xmax.push(region.x2)
        ymax.push(region.y2)
        tags.push(region.tags[0])
        console.log(`tag: ${region.tags[0]}`)
      });

      builder.setBytes('image/filename', encode_Uint8(id));
      builder.setBytes('image/encoded', encode_Uint8(id));
      builder.setBytes('image/format', encode_Uint8(id));
      builder.setBytes('image/height', encode_Uint8(id));
      
      builder.setBytes('image/key/sha526', encode_Uint8(id));
      
      builder.setBytes('image/object/class/label', encode_Uint8(id));
      builder.setBytes('image/object/class/text', encode_Uint8(id));

      builder.setFloats('image/object/bbox/xmin', xmin);
      builder.setFloats('image/object/bbox/ymin', ymin);
      builder.setFloats('image/object/bbox/xmax', xmax);
      builder.setFloats('image/object/bbox/ymax', ymax);

      example = builder.releaseExample();
    }
  }
  
  const writer = await tfrecord.createWriter(recordPath);
  await writer.writeExample(example);
  await writer.close();
  // console.log(example.features.feature)
}

async function readRecord(pathname, recordName) {
  const reader = await tfrecord.createReader(pathname + '\\' + recordName);
  let example;
  while (example = await reader.readExample()) {
    console.log(example.features.feature);
    return example;
  }
  // The reader auto-closes after it reaches the end of the file.
}

//saves current video to config 
function save() {
    var saveObject = {
      "frames" : videotagging.frames,
      "framerate":$('#framerate').val(),
      "inputTags": $('#inputtags').val().replace(/\s/g,''),
      "suggestiontype": $('#suggestiontype').val(),
      "scd": document.getElementById("scd").checked,
      "visitedFrames": Array.from(visitedFrames),
      "tag_colors" : videotagging.optionalTags.colors,
    };
    //if nothing changed don't save
    if (saveState === JSON.stringify(saveObject) ) {
      return;
    }

    var saveLock;
    if (!saveLock) {
      saveLock = true;
      fs.writeFile(`${videotagging.src}.json`, JSON.stringify(saveObject), () => {
        saveState = JSON.stringify(saveObject);
        console.log("saved");
      });
      if(videotagging.currTFRecord){
        let xmin = [];
        let ymin = [];
        let xmax = [];
        let ymax = [];
        let tags = [];
        let regions = videotagging.getRegions(videotagging.getCurrentFrameId());
        let sourceHeight = videotagging.currTFRecord.features.feature['image/height'].int64List.value[0]
        let sourceWidth = videotagging.currTFRecord.features.feature['image/width'].int64List.value[0]

        console.log(`regions: ${JSON.stringify(regions)}`);
        regions.forEach(region => {
          xmin.push(region.x1 / sourceWidth)
          ymin.push(region.y1 / sourceHeight)
          xmax.push(region.x2 / sourceWidth)
          ymax.push(region.y2 / sourceHeight)
          tags.push(encode_Uint8(region.tags[0]))
          // console.log(`encoded: ${encode_Uint8(region.tags[0])}`)
        })
        
        console.log(videotagging.currTFRecord.features.feature['image/object/bbox/xmin'].floatList.value)
        videotagging.currTFRecord.features.feature['image/object/bbox/xmin'].floatList.value = xmin;
        videotagging.currTFRecord.features.feature['image/object/bbox/xmax'].floatList.value = xmax;
        videotagging.currTFRecord.features.feature['image/object/bbox/ymin'].floatList.value = ymin;
        videotagging.currTFRecord.features.feature['image/object/bbox/ymax'].floatList.value = ymax;
        videotagging.currTFRecord.features.feature['image/object/class/text'].bytesList.value = tags
        videotagging.currTFRecord.features.feature['image/filename'].bytesList.value = [encode_Uint8('changed')]
        videotagging.recordlist[videotagging.imageIndex] = videotagging.currTFRecord;
        console.log(videotagging.currTFRecord.features.feature['image/object/bbox/xmin'].floatList.value)
        writeRecord(videotagging.imagelist[videotagging.imageIndex],videotagging.currTFRecord).then(()=>{
          console.log(`record saved: ${videotagging.imagelist[videotagging.imageIndex]}`)
          
          // console.log(`videotagging.currTFRecord: ${JSON.stringify(videotagging.currTFRecord)}`);
        });
      }
      setTimeout(() => {
        saveLock = false;
      }, 500);
    }

}

function encode_Uint8(s) {
  if (!("TextEncoder" in window)) alert("Sorry, this browser does not support TextEncoder...");
  
  var enc = new TextEncoder();
  return enc.encode(s)
  // return Uint8Array.from(s);
}

function decode_Uint8(uint8Arr) {
  return String.fromCharCode.apply(null, uint8Arr);
}

function deleteFrame(){
  if(!videotagging.imagelist) return;
  if(!confirm('This will delete the image from disk and remove it\'s tags from the save file.\nAre you sure you want to delete this image?')) return;
  let currFrameId = videotagging.getCurrentFrameId();
  
  try{
    fs.unlinkSync(videotagging.imagelist[videotagging.imageIndex]);
    delete videotagging.frames[currFrameId];
    
    videotagging.imagelist.splice(videotagging.imageIndex,1)
    
    var delObject = {
      "frames" : videotagging.frames,
      "framerate":$('#framerate').val(),
      "inputTags": $('#inputtags').val().replace(/\s/g,''),
      "suggestiontype": $('#suggestiontype').val(),
      "scd": document.getElementById("scd").checked,
      "visitedFrames": Array.from(visitedFrames),
      "tag_colors" : videotagging.optionalTags.colors,
    };
  
    var delLock;
    if (!delLock){
      delLock = true;
      try{
        fs.writeFile(`${videotagging.src}.json`, JSON.stringify(delObject),()=>{
          deleState = JSON.stringify(delObject);
        });
      }
      catch(error){
        console.error(error)
      }
      setTimeout(()=>{delLock=false;}, 500);
    }
  
    if(videotagging.imageIndex > 0){
      videotagging.imageIndex--
    }
  
    videotagging.stepFwdClicked({});
  }
  catch(error){
    console.error(error)
  }
}
