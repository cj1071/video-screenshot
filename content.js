// 使用立即执行函数来避免全局变量污染
(function() {
  // 检查是否已经初始化
  if (window.videoScreenshotExtensionInitialized) {
    console.log('视频截图扩展已经初始化，跳过重复初始化');
    return;
  }

  // 设置初始化标志
  window.videoScreenshotExtensionInitialized = true;
  console.log('初始化视频截图扩展...');

  // Global variables
  var captureInterval = null;
  var captureIntervalTime = 1000; // Default 1 second
  var imageQuality = 90;
  var imageFormat = 'png';
  var videoElements = [];
  var captureCount = 0;

// 持续检测相关变量
var continuousDetectionInterval = null;
var continuousDetectionCount = 0;
var maxDetectionAttempts = 30; // 最多尝试30次，每次间隔2秒，总共最多1分钟
var isDetectionActive = false; // 标记检测是否正在进行

// 合并截图相关变量
var capturedImages = []; // 存储截图的数组
var mergeAfterCount = 20; // 每收集20张截图合并一次
var mergeCount = 0; // 合并文件计数器
var keepOriginals = true; // 是否保留原始截图

// 自动停止相关变量
var autoStopTimer = null;
var autoStopMinutes = 0;
var enableAutoStop = false;

// 控制面板相关变量
var controlPanelInjected = false;
var capturePaused = false;

// 重复图片检测相关变量
var lastImageHash = null; // 上一张图片的哈希值
var enableDuplicateDetection = true; // 是否启用重复图片检测
var duplicateThreshold = 90; // 相似度阈值，默认90%
var skippedDuplicates = 0; // 跳过的重复图片数量

// 启动持续检测机制
function startContinuousDetection() {
  // 如果检测已经在进行，则不重复启动
  if (isDetectionActive) {
    console.log('持续检测已经在进行中，不重复启动');
    return;
  }

  // 标记检测开始
  isDetectionActive = true;
  continuousDetectionCount = 0;

  console.log('启动持续视频检测机制...');

  // 清除可能存在的旧定时器
  if (continuousDetectionInterval) {
    clearInterval(continuousDetectionInterval);
  }

  // 启动新的检测间隔
  continuousDetectionInterval = setInterval(() => {
    continuousDetectionCount++;
    console.log(`持续检测第 ${continuousDetectionCount} 次尝试...`);

    // 检测主页面和iframe中的视频
    detectVideos();

    // 如果找到了视频或者达到最大尝试次数，停止持续检测
    if (videoElements.length > 0) {
      console.log(`持续检测成功！在第 ${continuousDetectionCount} 次尝试中找到了 ${videoElements.length} 个视频`);
      clearInterval(continuousDetectionInterval);
      continuousDetectionInterval = null;
      isDetectionActive = false;

      // 同时停止定期检查iframe
      if (typeof periodicIframeCheckInterval !== 'undefined' && periodicIframeCheckInterval) {
        console.log('停止定期检查iframe');
        clearInterval(periodicIframeCheckInterval);
        periodicIframeCheckInterval = null;
      }
    } else if (continuousDetectionCount >= maxDetectionAttempts) {
      console.log('持续检测结束，未能找到视频元素');
      clearInterval(continuousDetectionInterval);
      continuousDetectionInterval = null;
      isDetectionActive = false;
    }
  }, 2000); // 每2秒检测一次
}

// Initialize when the content script is loaded
function initialize() {
  console.log('初始化视频检测...');
  // Find all video elements on the page
  detectVideos();

  // 如果找到视频，创建控制面板
  if (videoElements.length > 0) {
    injectControlPanel();
  }

  // 检查当前状态，如果正在截图，则恢复截图
  chrome.storage.local.get(['isCapturing', 'isPaused', 'interval', 'quality', 'format', 'mergeCount', 'mergeFormat', 'keepOriginals', 'autoStopMinutes', 'enableAutoStop', 'captureCount'], function(result) {
    console.log('初始化时获取到的状态:', result);

    // 更新控制面板状态
    if (result.isCapturing) {
      if (result.isPaused) {
        // 如果正在截图且已暂停
        capturePaused = true;
        updateControlPanelStatus('paused');
      } else {
        // 如果正在截图且未暂停，则恢复截图
        startCapture(result);
      }
    } else {
      // 如果未在截图
      updateControlPanelStatus('stopped');
    }

    // 更新截图计数
    if (result.captureCount !== undefined) {
      captureCount = result.captureCount;
      const countElement = document.getElementById('panel-count');
      if (countElement) {
        countElement.textContent = captureCount;
      }
    }
  });

  // Listen for new video elements being added to the page
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.addedNodes) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeName === 'VIDEO') {
            addVideoElement(node);
          } else if (node.nodeName === 'IFRAME') {
            // New iframe added, try to detect videos inside it
            setTimeout(() => {
              try {
                const iframeDoc = node.contentDocument || node.contentWindow.document;
                const iframeVideos = iframeDoc.querySelectorAll('video');
                iframeVideos.forEach(addVideoElement);
              } catch (e) {
                console.log('Cannot access new iframe content:', e);
              }
            }, 500); // Give the iframe some time to load
          } else if (node.querySelectorAll) {
            // Check for videos
            const videos = node.querySelectorAll('video');
            videos.forEach(addVideoElement);

            // Check for iframes
            const iframes = node.querySelectorAll('iframe');
            if (iframes.length > 0) {
              // Wait a bit for iframes to load their content
              setTimeout(() => detectVideosInIframes(), 500);
            }
          }
        });
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // 添加定期检查iframe的变量
  var periodicIframeCheckInterval = null;

  // 开始定期检查iframe中的视频
  function startPeriodicIframeCheck() {
    // 如果已经有一个定时器在运行，先清除它
    if (periodicIframeCheckInterval) {
      clearInterval(periodicIframeCheckInterval);
      periodicIframeCheckInterval = null;
    }

    // 如果检测已经停止，不启动新的定时器
    if (!isDetectionActive && videoElements.length === 0) {
      console.log('检测已停止，不启动定期检查iframe');
      return;
    }

    // 启动新的定时器
    periodicIframeCheckInterval = setInterval(() => {
      // 如果已经找到了视频或检测已停止，则停止定期检查
      if (videoElements.length > 0 || !isDetectionActive) {
        console.log('已找到视频或检测已停止，停止定期检查iframe');
        clearInterval(periodicIframeCheckInterval);
        periodicIframeCheckInterval = null;
        return;
      }

      // 检测 iframe 中的视频
      detectVideosInIframes();
    }, 5000);
  }

  // 启动定期检查
  startPeriodicIframeCheck();

  // 消息监听器已移动到文件底部
}

// Detect all video elements on the page including those in iframes
function detectVideos() {
  console.log('开始检测页面上的视频...');

  // Find videos in the main document
  const videos = document.querySelectorAll('video');
  console.log('在主页面上找到', videos.length, '个视频元素');
  videos.forEach(addVideoElement);

  // Find videos in iframes
  detectVideosInIframes();
}

// Detect videos in all iframes on the page
function detectVideosInIframes() {
  const iframes = document.querySelectorAll('iframe');
  console.log('在页面上找到', iframes.length, '个iframe');

  iframes.forEach(function(iframe, index) {
    console.log('检查iframe #', index + 1, ':', iframe.src || '无源地址');
    try {
      // Try to access iframe content - this will throw an error if cross-origin
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

      // 尝试使用不同的方法找到视频元素
      // 1. 直接查询video标签
      const iframeVideos = iframeDoc.querySelectorAll('video');
      console.log('在iframe #', index + 1, '中找到', iframeVideos.length, '个视频');
      iframeVideos.forEach(addVideoElement);

      // 2. 查找可能包含视频的元素
      const videoContainers = iframeDoc.querySelectorAll('.video-container, .player, .video-player, [class*="player"], [class*="video"], [id*="player"], [id*="video"]');
      console.log('在iframe #', index + 1, '中找到', videoContainers.length, '个可能的视频容器');

      videoContainers.forEach(function(container) {
        const containerVideos = container.querySelectorAll('video');
        if (containerVideos.length > 0) {
          console.log('在视频容器中找到', containerVideos.length, '个视频');
          containerVideos.forEach(addVideoElement);
        }
      });

      // 3. 检查嵌套iframe
      const nestedIframes = iframeDoc.querySelectorAll('iframe');
      if (nestedIframes.length > 0) {
        console.log('在iframe #', index + 1, '中找到', nestedIframes.length, '个嵌套iframe');
        nestedIframes.forEach(function(nestedIframe, nestedIndex) {
          console.log('检查嵌套iframe #', nestedIndex + 1, ':', nestedIframe.src || '无源地址');
          try {
            const nestedDoc = nestedIframe.contentDocument || nestedIframe.contentWindow.document;

            // 在嵌套iframe中查找video标签
            const nestedVideos = nestedDoc.querySelectorAll('video');
            console.log('在嵌套iframe中找到', nestedVideos.length, '个视频');
            nestedVideos.forEach(addVideoElement);

            // 在嵌套iframe中查找可能的视频容器
            const nestedContainers = nestedDoc.querySelectorAll('.video-container, .player, .video-player, [class*="player"], [class*="video"], [id*="player"], [id*="video"]');
            nestedContainers.forEach(function(container) {
              const containerVideos = container.querySelectorAll('video');
              if (containerVideos.length > 0) {
                console.log('在嵌套iframe的视频容器中找到', containerVideos.length, '个视频');
                containerVideos.forEach(addVideoElement);
              }
            });
          } catch (e) {
            // Cannot access nested iframe content (cross-origin)
            console.log('无法访问嵌套iframe内容 (跨域限制):', e.message);
          }
        });
      }
    } catch (e) {
      // Cannot access iframe content (cross-origin)
      console.log('无法访问 iframe #', index + 1, '内容 (跨域限制):', e.message);
    }
  });
}

// Add a video element to our tracking array
function addVideoElement(video) {
  if (!videoElements.includes(video)) {
    videoElements.push(video);
    console.log('检测到视频元素:', video);
    console.log('视频源:', video.currentSrc || video.src);
    console.log('视频尺寸:', video.videoWidth, 'x', video.videoHeight);
  }
}

// Start capturing screenshots
function startCapture(settings) {
  // Update settings
  captureIntervalTime = settings.interval * 1000; // Convert to milliseconds
  imageQuality = settings.quality;
  imageFormat = settings.format;
  mergeAfterCount = settings.mergeCount || 20; // 如果没有设置，默认为20
  keepOriginals = settings.keepOriginals !== undefined ? settings.keepOriginals : true; // 默认保留原始截图
  enableAutoStop = settings.enableAutoStop || false;
  autoStopMinutes = settings.autoStopMinutes || 0;

  // 重复图片检测设置
  enableDuplicateDetection = settings.enableDuplicateDetection !== undefined ? settings.enableDuplicateDetection : true;
  duplicateThreshold = settings.duplicateThreshold || 90;

  // 重置截图相关变量
  if (!capturePaused) { // 如果不是从暂停状态恢复，才重置计数器
    capturedImages = [];
    captureCount = 0;
    mergeCount = 0;
    skippedDuplicates = 0;
    lastImageHash = null; // 重置上一张图片的哈希值

    // 更新控制面板上的截图计数显示
    const countElement = document.getElementById('panel-count');
    if (countElement) {
      countElement.textContent = '0';
    }
  }

  capturePaused = false;

  // 更新存储中的状态，使弹出窗口可以同步
  chrome.storage.local.set({
    isCapturing: true,
    isPaused: false,
    captureCount: captureCount
  });

  console.log('开始截图设置:');
  console.log('- 截图间隔:', settings.interval, '秒 (', captureIntervalTime, '毫秒)');
  console.log('- 图片质量:', imageQuality);
  console.log('- 图片格式:', imageFormat);
  console.log('- 合并截图数量:', mergeAfterCount);
  console.log('- 合并文件格式:', settings.mergeFormat || 'html');
  console.log('- 保留原始截图:', keepOriginals ? '是' : '否');
  console.log('- 启用自动停止:', enableAutoStop ? '是' : '否');
  if (enableAutoStop) {
    console.log('- 自动停止时间:', autoStopMinutes, '分钟');
  }
  console.log('- 跳过重复图片:', enableDuplicateDetection ? '是' : '否');
  if (enableDuplicateDetection) {
    console.log('- 重复图片阈值:', duplicateThreshold, '%');
  }
  console.log('- 当前检测到的视频数量:', videoElements.length);

  // 重置跳过重复图片计数
  if (!capturePaused) {
    skippedDuplicates = 0;
    updateSkippedCount();
  }

  // Clear any existing interval
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }

  // Re-detect videos to make sure we have the latest
  detectVideos();

  // 如果没有找到视频，不开始截图
  if (videoElements.length === 0) {
    console.log('开始截图时未找到视频，无法开始截图');
    return;
  }

  // 找到视频后，停止定期检查iframe
  if (typeof periodicIframeCheckInterval !== 'undefined' && periodicIframeCheckInterval) {
    console.log('开始截图时停止定期检查iframe');
    clearInterval(periodicIframeCheckInterval);
    periodicIframeCheckInterval = null;
  }

  // Start a new interval
  captureInterval = setInterval(captureScreenshots, captureIntervalTime);
  console.log('已开始截图进程');

  // 注入控制面板
  injectControlPanel();

  // 更新控制面板按钮状态
  updateControlPanelButtons(true, false);

  // 重置面板计时器
  if (!capturePaused) {
    panelStartTime = new Date();
  }

  // 设置自动停止定时器
  if (enableAutoStop && autoStopMinutes > 0) {
    startAutoStopTimer();
  }
}

// Stop capturing screenshots
function stopCapture() {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
    console.log('已停止截图进程');
    console.log('本次截图总数:', captureCount);

    // 清除自动停止定时器
    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }

    // 重置暂停状态
    capturePaused = false;

    // 重置面板计时器
    panelStartTime = null;

    // 如果还有未合并的截图，弹出审核页面
    if (capturedImages.length > 0) {
      console.log(`还有 ${capturedImages.length} 张截图未合并，弹出审核页面...`);
      // 延迟一点时间再弹出审核页面，确保UI更新完成
      setTimeout(() => {
        showReviewPanel();
      }, 300);
    }

    // 更新控制面板状态
    updateControlPanelStatus('stopped');
    updateControlPanelButtons(false, false);

    // 更新审核按钮状态
    const reviewButton = document.getElementById('panel-review');
    if (reviewButton) {
      reviewButton.disabled = capturedImages.length === 0;
    }

    // 更新存储中的状态，使弹出窗口可以同步
    chrome.storage.local.set({
      isCapturing: false,
      isPaused: false,
      captureCount: captureCount
    });

    // 更新控制面板上的截图计数显示
    const countElement = document.getElementById('panel-count');
    if (countElement) {
      countElement.textContent = captureCount;
    }
  }
}

// Capture screenshots of all videos
function captureScreenshots() {
  console.log('正在截取视频画面, 当前视频数量:', videoElements.length);

  let readyVideos = 0;
  videoElements.forEach(function(video, index) {
    if (video.readyState >= 2) { // Check if video is loaded enough
      readyVideos++;
      captureVideoFrame(video, index);
    } else {
      console.log('视频 #', index + 1, '还未准备好, readyState =', video.readyState);
    }
  });

  if (readyVideos === 0 && videoElements.length > 0) {
    console.log('警告: 没有视频准备好可以截图');
  }
}

// Capture a single frame from a video
function captureVideoFrame(video, videoIndex) {
  console.log('正在截取视频 #', videoIndex + 1, '的画面');

  // Create a canvas element
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  if (canvas.width === 0 || canvas.height === 0) {
    console.log('错误: 视频尺寸为零 (' + canvas.width + 'x' + canvas.height + ')');
    return;
  }

  // Draw the video frame to the canvas
  const ctx = canvas.getContext('2d');
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 检查是否与上一张图片相似
    if (enableDuplicateDetection && isDuplicateImage(canvas, ctx)) {
      console.log(`跳过重复图片，已跳过 ${skippedDuplicates} 张`);
      return; // 如果是重复图片，则跳过
    }

    // Convert the canvas to a data URL
    let dataURL;
    if (imageFormat === 'jpeg') {
      dataURL = canvas.toDataURL('image/jpeg', imageQuality / 100);
    } else {
      dataURL = canvas.toDataURL('image/png');
    }

    // Generate a filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `video-${videoIndex + 1}-${timestamp}-${++captureCount}.${imageFormat}`;

    // 更新控制面板计数器
    updateCaptureCount();

    // 更新审核按钮状态
    const reviewButton = document.getElementById('panel-review');
    if (reviewButton) {
      reviewButton.disabled = false;
    }

    console.log('生成截图:', filename, '(尺寸:', canvas.width, 'x', canvas.height, ')');

    // 将截图添加到数组中，用于合并
    capturedImages.push({
      dataURL: dataURL,
      filename: filename,
      timestamp: new Date(),
      width: canvas.width,
      height: canvas.height,
      videoIndex: videoIndex,
      selected: true // 默认选中
    });

    // 检查是否达到合并阈值，但不立即合并，等待审核
    // 达到阈值时更新审核按钮状态，提示用户可以进行审核
    if (capturedImages.length >= mergeAfterCount) {
      console.log(`已达到合并阈值 ${mergeAfterCount}，等待人工审核...`);
      // 确保审核按钮可用
      const reviewButton = document.getElementById('panel-review');
      if (reviewButton) {
        reviewButton.disabled = false;
        // 闪烁提示用户可以审核
        reviewButton.style.animation = 'button-flash 1s infinite';
      }
    }

    // 如果设置为保留原始截图，则下载单独的截图
    if (keepOriginals) {
      // 尝试使用临时链接直接下载
      try {
        // 创建一个临时的a标签
        const downloadLink = document.createElement('a');
        downloadLink.href = dataURL;
        downloadLink.download = filename;
        downloadLink.style.display = 'none';

        // 将链接添加到文档中
        document.body.appendChild(downloadLink);

        // 模拟点击事件
        downloadLink.click();

        // 从文档中移除链接
        setTimeout(() => {
          document.body.removeChild(downloadLink);
        }, 100);

        console.log('截图保存成功 (使用临时链接):', filename);
      } catch (directDownloadError) {
        console.log('使用临时链接下载失败，尝试使用background脚本:', directDownloadError.message);

        // 如果直接下载失败，尝试使用background脚本
        chrome.runtime.sendMessage({
          action: 'downloadScreenshot',
          dataURL: dataURL,
          filename: filename
        }, function(response) {
          if (response && response.success) {
            console.log('截图保存成功 (使用background脚本):', filename);
          } else {
            console.log('截图保存失败:', response ? response.error : '未知原因');
          }
        });
      }
    } else {
      console.log('已设置不保留原始截图，只在合并后保存');
    }
  } catch (e) {
    console.log('截取视频画面时出错:', e.message);
  }
}

// 启动持续检测机制
function startContinuousDetection() {
  // 如果已经有一个持续检测在运行，先清除它
  if (continuousDetectionInterval) {
    clearInterval(continuousDetectionInterval);
  }

  // 标记检测开始
  isDetectionActive = true;
  // 重置计数器
  continuousDetectionCount = 0;

  console.log('启动持续视频检测机制...');

  // 启动新的检测间隔
  continuousDetectionInterval = setInterval(() => {
    continuousDetectionCount++;
    console.log(`持续检测第 ${continuousDetectionCount} 次尝试...`);

    // 检测主页面和iframe中的视频
    detectVideos();

    // 如果找到视频，创建控制面板
    if (videoElements.length > 0 && !controlPanelInjected) {
      injectControlPanel();
    }

    // 如果找到了视频或者达到最大尝试次数，停止持续检测
    if (videoElements.length > 0) {
      console.log(`持续检测成功！在第 ${continuousDetectionCount} 次尝试中找到了 ${videoElements.length} 个视频`);
      // 停止持续检测
      clearInterval(continuousDetectionInterval);
      continuousDetectionInterval = null;
      isDetectionActive = false;

      // 设置视频检测状态为true，这样弹出窗口中的开始按钮可用
      chrome.storage.local.set({
        videoDetected: true,
        videoCount: videoElements.length
      }, function() {
        console.log('视频检测状态已保存到存储中');

        // 通知popup已找到视频
        chrome.runtime.sendMessage({
          action: 'videoDetected',
          count: videoElements.length
        });
      });
    } else if (continuousDetectionCount >= maxDetectionAttempts) {
      console.log('持续检测结束，未能找到视频元素');
      stopContinuousDetection();

      // 通知popup未找到视频
      chrome.runtime.sendMessage({
        action: 'videoDetectionFailed'
      });
    }
  }, 2000); // 每2秒检测一次
}

// 停止持续检测机制
function stopContinuousDetection() {
  if (!isDetectionActive) {
    return;
  }

  console.log('停止持续检测机制');
  isDetectionActive = false;

  if (continuousDetectionInterval) {
    clearInterval(continuousDetectionInterval);
    continuousDetectionInterval = null;
  }
}

// 合并并下载截图
function mergeAndDownloadImages() {
  if (capturedImages.length === 0) {
    console.log('没有截图可以合并');
    return;
  }

  // 过滤出被选中的图片
  const selectedImages = capturedImages.filter(img => img.selected);

  if (selectedImages.length === 0) {
    console.log('没有选中的截图可以合并');
    capturedImages = []; // 清空截图数组
    return;
  }

  console.log(`开始合并 ${selectedImages.length} 张选中的截图（共 ${capturedImages.length} 张）...`);
  mergeCount++;

  // 获取当前时间作为文件名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mergeFilename = `merged-screenshots-${mergeCount}-${timestamp}.html`;

  // 创建HTML内容
  let htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>视频截图集合 - ${timestamp}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
      h1 { text-align: center; color: #333; }
      .header { text-align: center; margin-bottom: 20px; }
      .grid-container {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 15px;
        margin-bottom: 30px;
      }
      .screenshot-container {
        background-color: white;
        border-radius: 8px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        padding: 15px;
        transition: transform 0.2s;
      }
      .screenshot-container:hover {
        transform: scale(1.02);
        box-shadow: 0 5px 15px rgba(0,0,0,0.1);
      }
      .screenshot {
        width: 100%;
        height: auto;
        border-radius: 4px;
        cursor: pointer;
      }
      .info { margin-top: 10px; color: #666; font-size: 12px; }
      .timestamp { font-weight: bold; color: #444; }

      /* 全屏查看模式 */
      .fullscreen-view {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.9);
        z-index: 1000;
        justify-content: center;
        align-items: center;
        flex-direction: column;
      }
      .fullscreen-image {
        max-width: 90%;
        max-height: 80%;
        object-fit: contain;
      }
      .fullscreen-controls {
        margin-top: 15px;
        color: white;
      }
      .fullscreen-close {
        position: absolute;
        top: 20px;
        right: 20px;
        color: white;
        font-size: 30px;
        cursor: pointer;
      }
      .nav-button {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        padding: 10px 15px;
        margin: 0 10px;
        border-radius: 4px;
        cursor: pointer;
      }
    </style>
    <script>
      // 全屏查看功能
      let currentIndex = 0;
      const images = [];

      function showFullscreen(index) {
        currentIndex = index;
        const fullscreenView = document.getElementById('fullscreen-view');
        const fullscreenImage = document.getElementById('fullscreen-image');

        fullscreenImage.src = images[index].src;
        fullscreenView.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        document.getElementById('image-counter').textContent = \`\${currentIndex + 1} / \${images.length}\`;
      }

      function closeFullscreen() {
        document.getElementById('fullscreen-view').style.display = 'none';
        document.body.style.overflow = 'auto';
      }

      function navigateImages(direction) {
        currentIndex = (currentIndex + direction + images.length) % images.length;
        document.getElementById('fullscreen-image').src = images[currentIndex].src;
        document.getElementById('image-counter').textContent = \`\${currentIndex + 1} / \${images.length}\`;
      }

      document.addEventListener('keydown', function(e) {
        if (document.getElementById('fullscreen-view').style.display === 'flex') {
          if (e.key === 'Escape') closeFullscreen();
          if (e.key === 'ArrowLeft') navigateImages(-1);
          if (e.key === 'ArrowRight') navigateImages(1);
        }
      });

      window.onload = function() {
        // 收集所有图片
        document.querySelectorAll('.screenshot').forEach(img => {
          images.push(img);
          img.addEventListener('click', function() {
            const index = images.indexOf(this);
            showFullscreen(index);
          });
        });
      };
    </script>
  </head>
  <body>
    <div class="header">
      <h1>视频截图集合</h1>
      <p>生成时间: ${new Date().toLocaleString()}</p>
      <p>共 ${selectedImages.length} 张截图</p>
    </div>

    <!-- 全屏查看模式 -->
    <div id="fullscreen-view" class="fullscreen-view" onclick="closeFullscreen()">
      <span class="fullscreen-close">&times;</span>
      <img id="fullscreen-image" class="fullscreen-image" onclick="event.stopPropagation()">
      <div class="fullscreen-controls" onclick="event.stopPropagation()">
        <button class="nav-button" onclick="navigateImages(-1)">上一张</button>
        <span id="image-counter">1 / ${selectedImages.length}</span>
        <button class="nav-button" onclick="navigateImages(1)">下一张</button>
      </div>
    </div>

    <div class="grid-container">
  `;

  // 添加每张选中的截图
  selectedImages.forEach((image, index) => {
    htmlContent += `
    <div class="screenshot-container">
      <img class="screenshot" src="${image.dataURL}" alt="截图 ${index + 1}">
      <div class="info">
        <p class="timestamp">截图 #${index + 1} - 视频 #${image.videoIndex + 1}</p>
        <p>时间: ${image.timestamp.toLocaleString()}</p>
        <p>尺寸: ${image.width} x ${image.height}</p>
      </div>
    </div>
    `;
  });

  // 完成HTML
  htmlContent += `
    </div> <!-- 关闭 grid-container -->
  </body>
  </html>
  `;

  // 创建Blob并下载
  const blob = new Blob([htmlContent], {type: 'text/html'});
  const url = URL.createObjectURL(blob);

  try {
    // 创建一个临时的a标签
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = mergeFilename;
    downloadLink.style.display = 'none';

    // 将链接添加到文档中
    document.body.appendChild(downloadLink);

    // 模拟点击事件
    downloadLink.click();

    // 从文档中移除链接
    setTimeout(() => {
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(url);
    }, 100);

    console.log(`合并截图成功，已保存为 ${mergeFilename}`);

    // 清空截图数组，准备下一批
    capturedImages = [];

    // 更新审核按钮状态
    const reviewButton = document.getElementById('panel-review');
    if (reviewButton) {
      reviewButton.disabled = true;
    }
  } catch (e) {
    console.log('合并截图时出错:', e.message);
  }
}

// 启动自动停止定时器
function startAutoStopTimer() {
  if (autoStopTimer) {
    clearTimeout(autoStopTimer);
  }

  const milliseconds = autoStopMinutes * 60 * 1000;
  console.log(`设置自动停止定时器: ${autoStopMinutes} 分钟`);

  autoStopTimer = setTimeout(() => {
    console.log('到达设定的自动停止时间，正在停止截图...');
    stopCapture();
    alert('截图已按设定时间自动停止，请进行图片审核');
  }, milliseconds);
}

// 暂停截图
function pauseCapture() {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
    capturePaused = true;
    console.log('截图已暂停');

    // 更新控制面板状态
    updateControlPanelStatus('paused');
    updateControlPanelButtons(true, true);

    // 更新存储中的状态，使弹出窗口可以同步
    chrome.storage.local.set({
      isCapturing: true,
      isPaused: true,
      captureCount: captureCount
    });
  }
}

// 恢复截图
function resumeCapture() {
  if (capturePaused) {
    captureInterval = setInterval(captureScreenshots, captureIntervalTime);
    capturePaused = false;
    console.log('截图已恢复');

    // 更新控制面板状态
    updateControlPanelStatus('active');
    updateControlPanelButtons(true, false);

    // 更新存储中的状态，使弹出窗口可以同步
    chrome.storage.local.set({
      isCapturing: true,
      isPaused: false,
      captureCount: captureCount
    });
  }
}

// 创建控制面板
function injectControlPanel() {
  if (controlPanelInjected) {
    return;
  }

  // 创建控制面板样式
  const style = document.createElement('style');
  style.textContent = `
    /* 按钮闪烁动画 */
    @keyframes button-flash {
      0% { background-color: #2196F3; }
      50% { background-color: #0b7dda; }
      100% { background-color: #2196F3; }
    }

    /* 审核面板样式 */
    .review-panel {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.8);
      z-index: 9999999;
      display: none;
      flex-direction: column;
      align-items: center;
      overflow: auto;
      padding: 20px;
      box-sizing: border-box;
    }

    .review-panel-header {
      color: white;
      margin-bottom: 20px;
      text-align: center;
      width: 100%;
    }

    .review-panel-title {
      font-size: 24px;
      margin-bottom: 10px;
    }

    .review-panel-subtitle {
      font-size: 16px;
      color: #ccc;
    }

    .review-panel-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 15px;
      width: 100%;
      max-width: 1200px;
      margin-bottom: 20px;
    }

    .review-image-container {
      background-color: #333;
      border-radius: 8px;
      padding: 10px;
      position: relative;
      transition: all 0.2s ease;
    }

    .review-image-container.selected {
      background-color: #2196F3;
    }

    .review-image-container:hover {
      transform: scale(1.02);
    }

    .review-image {
      width: 100%;
      height: auto;
      border-radius: 4px;
      cursor: pointer;
    }

    .review-image-info {
      color: white;
      font-size: 12px;
      margin-top: 8px;
    }

    .review-checkbox {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 20px;
      height: 20px;
      cursor: pointer;
    }

    .review-panel-actions {
      display: flex;
      justify-content: center;
      gap: 15px;
      margin-top: 20px;
    }

    .review-button {
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .review-confirm {
      background-color: #4CAF50;
      color: white;
    }

    .review-confirm:hover {
      background-color: #3e8e41;
    }

    .review-cancel {
      background-color: #f44336;
      color: white;
    }

    .review-cancel:hover {
      background-color: #d32f2f;
    }

    .review-select-all {
      background-color: #2196F3;
      color: white;
    }

    .review-select-all:hover {
      background-color: #0b7dda;
    }

    .control-panel {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 250px;
      background-color: rgba(255, 255, 255, 0.9);
      border-radius: 8px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
      z-index: 9999999;
      padding: 15px;
      font-family: Arial, sans-serif;
      transition: all 0.3s ease;
      transform: translateX(270px);
      cursor: move;
    }

    .control-panel.visible {
      transform: translateX(0);
    }

    .control-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
      border-bottom: 1px solid #eee;
      padding-bottom: 10px;
    }

    .control-panel-title {
      font-weight: bold;
      font-size: 16px;
      color: #333;
      margin: 0;
    }

    .control-panel-toggle {
      position: absolute;
      left: -40px;
      top: 10px;
      width: 40px;
      height: 40px;
      background-color: rgba(255, 255, 255, 0.9);
      border-radius: 8px 0 0 8px;
      display: flex;
      justify-content: center;
      align-items: center;
      cursor: pointer;
      box-shadow: -4px 0 10px rgba(0, 0, 0, 0.1);
    }

    .control-panel-toggle i {
      border: solid #333;
      border-width: 0 3px 3px 0;
      display: inline-block;
      padding: 3px;
      transform: rotate(135deg);
    }

    .control-panel.visible .control-panel-toggle i {
      transform: rotate(-45deg);
    }

    .control-panel-content {
      margin-bottom: 15px;
    }

    .control-panel-stat {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 14px;
    }

    .control-panel-stat-label {
      color: #666;
    }

    .control-panel-stat-value {
      font-weight: bold;
      color: #333;
    }

    .control-panel-buttons {
      display: flex;
      justify-content: space-between;
    }

    .control-panel-button {
      padding: 8px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      font-size: 12px;
      transition: all 0.2s ease;
      flex: 1;
      margin: 0 5px;
    }

    .control-panel-button:first-child {
      margin-left: 0;
    }

    .control-panel-button:last-child {
      margin-right: 0;
    }

    .btn-start-panel {
      background-color: #4CAF50;
      color: white;
    }

    .btn-start-panel:hover {
      background-color: #3e8e41;
    }

    .btn-pause-panel {
      background-color: #ff9800;
      color: white;
    }

    .btn-pause-panel:hover {
      background-color: #e68a00;
    }

    .btn-stop-panel {
      background-color: #f44336;
      color: white;
    }

    .btn-stop-panel:hover {
      background-color: #d32f2f;
    }

    .btn-review-panel {
      background-color: #2196F3;
      color: white;
    }

    .btn-review-panel:hover {
      background-color: #0b7dda;
    }

    .control-panel-button:disabled {
      background-color: #cccccc;
      cursor: not-allowed;
    }

    .control-panel-timer {
      text-align: center;
      margin-top: 10px;
      font-size: 12px;
      color: #666;
    }

    .control-panel-progress {
      width: 100%;
      height: 4px;
      background-color: #eee;
      border-radius: 2px;
      margin-top: 5px;
      overflow: hidden;
    }

    .control-panel-progress-bar {
      height: 100%;
      background-color: #4CAF50;
      width: 0%;
      transition: width 1s linear;
    }
  `;
  document.head.appendChild(style);

  // 创建控制面板元素
  const panel = document.createElement('div');
  panel.className = 'control-panel';
  panel.id = 'screenshot-control-panel';

  // 添加控制面板内容
  panel.innerHTML = `
    <div class="control-panel-toggle" id="panel-toggle">
      <i></i>
    </div>
    <div class="control-panel-header">
      <h3 class="control-panel-title">视频截图控制面板</h3>
    </div>
    <div class="control-panel-content">
      <div class="control-panel-stat">
        <span class="control-panel-stat-label">状态:</span>
        <span class="control-panel-stat-value" id="panel-status">未开始</span>
      </div>
      <div class="control-panel-stat">
        <span class="control-panel-stat-label">已截图数量:</span>
        <span class="control-panel-stat-value" id="panel-count">0</span>
      </div>
      <div class="control-panel-stat">
        <span class="control-panel-stat-label">跳过重复:</span>
        <span class="control-panel-stat-value" id="panel-skipped">0</span>
      </div>
      <div class="control-panel-stat">
        <span class="control-panel-stat-label">运行时间:</span>
        <span class="control-panel-stat-value" id="panel-time">00:00:00</span>
      </div>
    </div>
    <div class="control-panel-buttons">
      <button class="control-panel-button btn-start-panel" id="panel-start">开始</button>
      <button class="control-panel-button btn-pause-panel" id="panel-pause" disabled>暂停</button>
      <button class="control-panel-button btn-stop-panel" id="panel-stop" disabled>停止</button>
    </div>
    <div class="control-panel-buttons" style="margin-top: 10px;">
      <button class="control-panel-button btn-review-panel" id="panel-review" disabled>审核截图</button>
    </div>
    <div class="control-panel-timer" id="auto-stop-timer"></div>
    <div class="control-panel-progress">
      <div class="control-panel-progress-bar" id="auto-stop-progress"></div>
    </div>
  `;

  // 添加到页面
  document.body.appendChild(panel);

  // 添加事件监听器
  document.getElementById('panel-toggle').addEventListener('click', toggleControlPanel);
  document.getElementById('panel-start').addEventListener('click', startCaptureFromPanel);
  document.getElementById('panel-pause').addEventListener('click', togglePauseCapture);
  document.getElementById('panel-stop').addEventListener('click', stopCaptureFromPanel);
  document.getElementById('panel-review').addEventListener('click', showReviewPanel);

  // 添加拖拽功能
  makePanelDraggable();

  // 显示控制面板
  setTimeout(() => {
    toggleControlPanel();
  }, 1000);

  // 启动计时器
  startPanelTimer();

  // 从存储中获取当前状态，更新控制面板
  chrome.storage.local.get(['isCapturing', 'isPaused', 'captureCount'], function(result) {
    console.log('控制面板初始化时获取到的状态:', result);

    if (result.captureCount !== undefined) {
      const countElement = document.getElementById('panel-count');
      if (countElement) {
        countElement.textContent = result.captureCount;
      }
    }

    if (result.isCapturing) {
      if (result.isPaused) {
        // 如果正在截图且已暂停
        updateControlPanelButtons(true, true);
      } else {
        // 如果正在截图且未暂停
        updateControlPanelButtons(true, false);
      }
    } else {
      // 如果未在截图
      updateControlPanelButtons(false, false);
    }
  });

  controlPanelInjected = true;
}

// 切换控制面板显示/隐藏
function toggleControlPanel() {
  const panel = document.getElementById('screenshot-control-panel');
  if (panel) {
    panel.classList.toggle('visible');
  }
}

// 从控制面板开始截图
function startCaptureFromPanel() {
  console.log('从控制面板开始截图');
  // 从存储中获取完整的设置
  chrome.storage.local.get([
    'interval',
    'quality',
    'format',
    'mergeCount',
    'mergeFormat',
    'keepOriginals',
    'autoStopMinutes',
    'enableAutoStop',
    'duplicateThreshold',
    'enableDuplicateDetection'
  ], function(result) {
    if (capturePaused) {
      // 如果是从暂停状态恢复
      console.log('从暂停状态恢复截图');
      resumeCapture();
    } else {
      // 全新开始截图
      console.log('全新开始截图，设置:', result);

      // 确保所有设置都有默认值
      const settings = {
        interval: result.interval || 1,
        quality: result.quality || 90,
        format: result.format || 'png',
        mergeCount: result.mergeCount || 20,
        mergeFormat: result.mergeFormat || 'html',
        keepOriginals: result.keepOriginals !== undefined ? result.keepOriginals : false,
        autoStopMinutes: result.autoStopMinutes || 0,
        enableAutoStop: result.enableAutoStop || false,
        duplicateThreshold: result.duplicateThreshold || 90,
        enableDuplicateDetection: result.enableDuplicateDetection !== undefined ? result.enableDuplicateDetection : true
      };

      startCapture(settings);

      // 设置截图状态
      chrome.storage.local.set({
        isCapturing: true,
        isPaused: false
      });
    }

    // 更新控制面板按钮状态
    updateControlPanelButtons(true, false);

    // 发送消息给popup，通知其更新UI
    chrome.runtime.sendMessage({
      action: 'updatePopupUI',
      status: 'active'
    });
  });
}

// 从控制面板停止截图
function stopCaptureFromPanel() {
  console.log('从控制面板停止截图');
  stopCapture();

  // 更新控制面板按钮状态，启用开始按钮，禁用停止和暂停按钮
  const startButton = document.getElementById('panel-start');
  const pauseButton = document.getElementById('panel-pause');
  const stopButton = document.getElementById('panel-stop');

  if (startButton && pauseButton && stopButton) {
    startButton.disabled = false;
    pauseButton.disabled = true;
    stopButton.disabled = true;
  }

  updateControlPanelButtons(false, false);

  // 确保弹出窗口中的开始按钮也能正常工作
  // 保持videoDetected状态为true，这样弹出窗口中的开始按钮仍然可用
  // 同时设置isCapturing为false，确保弹出窗口中的状态正确同步
  chrome.storage.local.set({
    videoDetected: true,
    videoCount: videoElements.length,
    isCapturing: false,
    isPaused: false
  }, function() {
    console.log('控制面板停止截图后更新存储状态成功');

    // 尝试多种方式通知popup更新UI
    try {
      // 方式1: 发送消息给popup
      chrome.runtime.sendMessage({
        action: 'updatePopupUI',
        status: 'stopped'
      });

      // 方式2: 直接触发存储变化事件
      setTimeout(function() {
        chrome.storage.local.set({
          videoDetected: true,
          videoCount: videoElements.length
        });
      }, 100);
    } catch (error) {
      console.error('发送消息给popup时出错:', error);
    }
  });
}

// 切换暂停/继续截图
function togglePauseCapture() {
  console.log('切换暂停/继续截图');

  if (capturePaused) {
    // 如果当前是暂停状态，则恢复截图
    console.log('当前是暂停状态，恢复截图');
    resumeCapture();
    updateControlPanelButtons(true, false);
  } else {
    // 否则暂停截图
    console.log('当前是运行状态，暂停截图');
    pauseCapture();
    updateControlPanelButtons(true, true);
  }
}

// 更新控制面板按钮状态
function updateControlPanelButtons(isCapturing, isPaused) {
  console.log('更新控制面板按钮状态:', isCapturing, isPaused);
  const startButton = document.getElementById('panel-start');
  const pauseButton = document.getElementById('panel-pause');
  const stopButton = document.getElementById('panel-stop');
  const reviewButton = document.getElementById('panel-review');
  const statusElement = document.getElementById('panel-status');

  if (!startButton || !pauseButton || !stopButton || !reviewButton || !statusElement) {
    console.log('控制面板元素未找到，可能尚未创建');
    return;
  }

  if (isCapturing) {
    startButton.disabled = true;
    stopButton.disabled = false;

    if (isPaused) {
      pauseButton.disabled = false;
      pauseButton.textContent = '继续';
      statusElement.textContent = '已暂停';
    } else {
      pauseButton.disabled = false;
      pauseButton.textContent = '暂停';
      statusElement.textContent = '正在截图';
    }
  } else {
    startButton.disabled = false;
    pauseButton.disabled = true;
    stopButton.disabled = true;
    pauseButton.textContent = '暂停';
    statusElement.textContent = '已停止';
  }

  // 如果有截图，启用审核按钮
  reviewButton.disabled = capturedImages.length === 0;

  // 同步状态到存储，使弹出窗口可以同步
  chrome.storage.local.set({
    isCapturing: isCapturing,
    isPaused: isPaused || false
  });
}

// 更新控制面板状态
function updateControlPanelStatus(status) {
  const statusElement = document.getElementById('panel-status');
  if (!statusElement) return;

  switch (status) {
    case 'active':
      statusElement.textContent = '正在截图';
      updateControlPanelButtons(true, false);
      break;
    case 'paused':
      statusElement.textContent = '已暂停';
      updateControlPanelButtons(true, true);
      break;
    case 'stopped':
      statusElement.textContent = '已停止';
      updateControlPanelButtons(false, false);
      break;
  }
}

// 更新控制面板计数器
function updateCaptureCount() {
  const countElement = document.getElementById('panel-count');
  if (countElement) {
    countElement.textContent = captureCount;
  }

  // 更新存储中的计数器，使弹出窗口可以同步
  chrome.storage.local.set({
    captureCount: captureCount
  });
}

// 更新跳过重复图片计数
function updateSkippedCount() {
  const skippedElement = document.getElementById('panel-skipped');
  if (skippedElement) {
    skippedElement.textContent = skippedDuplicates;
  }

  // 更新存储中的跳过计数器
  chrome.storage.local.set({
    skippedDuplicates: skippedDuplicates
  });
}

// 控制面板计时器
var panelTimerInterval = null;
var panelStartTime = null;

// 启动控制面板计时器
function startPanelTimer() {
  if (panelTimerInterval) {
    clearInterval(panelTimerInterval);
  }

  panelTimerInterval = setInterval(updatePanelTimer, 1000);
}

// 更新控制面板计时器
function updatePanelTimer() {
  if (!captureInterval || capturePaused) return;

  if (!panelStartTime && captureInterval) {
    panelStartTime = new Date();
  }

  if (panelStartTime) {
    const now = new Date();
    const elapsedTime = Math.floor((now - panelStartTime) / 1000);

    const hours = Math.floor(elapsedTime / 3600);
    const minutes = Math.floor((elapsedTime % 3600) / 60);
    const seconds = elapsedTime % 60;

    const timeString =
      (hours < 10 ? '0' + hours : hours) + ':' +
      (minutes < 10 ? '0' + minutes : minutes) + ':' +
      (seconds < 10 ? '0' + seconds : seconds);

    const timeElement = document.getElementById('panel-time');
    if (timeElement) {
      timeElement.textContent = timeString;
    }

    // 更新自动停止进度条
    if (enableAutoStop && autoStopMinutes > 0) {
      const totalSeconds = autoStopMinutes * 60;
      const remainingSeconds = totalSeconds - elapsedTime;

      if (remainingSeconds > 0) {
        const progress = ((totalSeconds - remainingSeconds) / totalSeconds) * 100;
        const progressBar = document.getElementById('auto-stop-progress');
        if (progressBar) {
          progressBar.style.width = progress + '%';
        }

        const remainingMinutes = Math.floor(remainingSeconds / 60);
        const remainingSecs = remainingSeconds % 60;
        const timerElement = document.getElementById('auto-stop-timer');
        if (timerElement) {
          timerElement.textContent =
            `自动停止倒计时: ${remainingMinutes}:${remainingSecs < 10 ? '0' + remainingSecs : remainingSecs}`;
        }
      }
    }
  }
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener(function(request, _sender, sendResponse) {
  console.log('收到消息:', request.action);
  switch (request.action) {
    case 'getStatus':
      sendResponse({
        isCapturing: captureInterval !== null,
        isPaused: capturePaused,
        captureCount: captureCount
      });
      break;

    case 'updateControlPanel':
      console.log('收到更新控制面板状态消息:', request.status);
      updateControlPanelStatus(request.status);
      sendResponse({success: true});
      break;

    case 'startCapture':
      console.log('收到开始截图消息');
      startCapture(request.settings);
      sendResponse({success: true});
      break;

    case 'startDetection':
      console.log('收到开始检测视频消息');
      if (request.maxAttempts) {
        maxDetectionAttempts = request.maxAttempts;
      }
      startContinuousDetection();
      sendResponse({success: true});
      break;

    case 'stopDetection':
      console.log('收到停止检测视频消息');
      stopContinuousDetection();
      sendResponse({success: true});
      break;

    case 'getDetectionStatus':
      sendResponse({
        found: videoElements.length > 0,
        count: videoElements.length,
        attempts: continuousDetectionCount,
        active: isDetectionActive
      });
      break;

    case 'getVideoCount':
      sendResponse({
        videoCount: videoElements.length
      });
      break;
  }
  return true; // 保持消息通道开放以进行异步响应
});

// 计算图像的高级感知哈希值(pHash)
function calculateImageHash(canvas, _ctx, size = 32, smallerSize = 8) {
  // 第1步：缩放图像到32x32
  const mediumCanvas = document.createElement('canvas');
  mediumCanvas.width = size;
  mediumCanvas.height = size;
  const mediumCtx = mediumCanvas.getContext('2d');
  mediumCtx.drawImage(canvas, 0, 0, size, size);

  // 获取像素数据并转换为灰度
  const mediumData = mediumCtx.getImageData(0, 0, size, size).data;
  const grayMatrix = new Array(size);

  for (let y = 0; y < size; y++) {
    grayMatrix[y] = new Array(size);
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // 转换RGB为灰度值
      grayMatrix[y][x] = 0.299 * mediumData[i] + 0.587 * mediumData[i + 1] + 0.114 * mediumData[i + 2];
    }
  }

  // 第2步：应用离散余弦变换(DCT)
  // 由于浏览器环境限制，我们使用简化版DCT
  const dctMatrix = applySimplifiedDCT(grayMatrix, size);

  // 第3步：提取低频部分(左上角8x8)
  const lowFreqMatrix = new Array(smallerSize);
  for (let y = 0; y < smallerSize; y++) {
    lowFreqMatrix[y] = new Array(smallerSize);
    for (let x = 0; x < smallerSize; x++) {
      lowFreqMatrix[y][x] = dctMatrix[y][x];
    }
  }

  // 第4步：计算平均值(不包括第一个直流分量)
  let sum = 0;
  let count = 0;

  for (let y = 0; y < smallerSize; y++) {
    for (let x = 0; x < smallerSize; x++) {
      // 跳过直流分量(0,0)
      if (!(y === 0 && x === 0)) {
        sum += lowFreqMatrix[y][x];
        count++;
      }
    }
  }

  const avg = sum / count;

  // 第5步：生成哈希值
  let hash = '';
  for (let y = 0; y < smallerSize; y++) {
    for (let x = 0; x < smallerSize; x++) {
      // 跳过直流分量(0,0)
      if (!(y === 0 && x === 0)) {
        hash += lowFreqMatrix[y][x] >= avg ? '1' : '0';
      }
    }
  }

  return hash;
}

// 简化版的离散余弦变换(DCT)
function applySimplifiedDCT(matrix, size) {
  const result = new Array(size);
  for (let i = 0; i < size; i++) {
    result[i] = new Array(size).fill(0);
  }

  // 简化版DCT变换
  for (let u = 0; u < size; u++) {
    for (let v = 0; v < size; v++) {
      let sum = 0;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          // DCT变换公式的简化版本
          const cosU = Math.cos((2 * x + 1) * u * Math.PI / (2 * size));
          const cosV = Math.cos((2 * y + 1) * v * Math.PI / (2 * size));
          sum += matrix[y][x] * cosU * cosV;
        }
      }

      // 归一化系数
      const alphaU = u === 0 ? 1 / Math.sqrt(size) : Math.sqrt(2 / size);
      const alphaV = v === 0 ? 1 / Math.sqrt(size) : Math.sqrt(2 / size);

      result[u][v] = alphaU * alphaV * sum;
    }
  }

  return result;
}

// 计算两个哈希值的汉明距离（不同位的数量）
function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) {
    return 0; // 如果哈希值无效或长度不同，返回最低相似度
  }

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }

  // 返回相似度百分比（0-100），使用非线性映射增强差异
  const rawSimilarity = 100 - Math.floor((distance / hash1.length) * 100);

  // 应用非线性映射，使得相似度在高值区域更敏感
  // 这样可以避免误判为100%相似
  if (rawSimilarity > 90) {
    // 在高相似度区域，使用更敏感的映射
    return 90 + (rawSimilarity - 90) * 0.5;
  } else if (rawSimilarity > 80) {
    // 在中高相似度区域，稍微降低相似度
    return 80 + (rawSimilarity - 80) * 0.8;
  }

  return rawSimilarity;
}

// 检查图像是否与上一张相似
function isDuplicateImage(canvas, ctx) {
  if (!enableDuplicateDetection) {
    return false; // 如果未启用重复检测，则不跳过任何图片
  }

  // 将图像分为多个区域进行比较
  const regionHashes = calculateRegionHashes(canvas, ctx);

  if (!lastRegionHashes) {
    // 如果这是第一张图片，保存区域哈希值
    lastRegionHashes = regionHashes;
    // 保存全局哈希值以兼容原有代码
    lastImageHash = regionHashes.globalHash;
    return false;
  }

  // 计算各个区域的相似度
  const regionSimilarities = [];
  for (let i = 0; i < regionHashes.regions.length; i++) {
    const similarity = hammingDistance(lastRegionHashes.regions[i], regionHashes.regions[i]);
    regionSimilarities.push(similarity);
  }

  // 计算全局相似度
  const globalSimilarity = hammingDistance(lastRegionHashes.globalHash, regionHashes.globalHash);

  // 找出变化最大的区域
  const minSimilarity = Math.min(...regionSimilarities);
  const maxSimilarity = Math.max(...regionSimilarities);

  // 计算加权平均相似度，给予全局哈希和最不相似区域更高的权重
  const weightedSimilarity = 0.4 * globalSimilarity + 0.4 * minSimilarity + 0.2 * (regionSimilarities.reduce((a, b) => a + b, 0) / regionSimilarities.length);

  // 输出详细的相似度信息便于调试
  console.log(`全局相似度: ${globalSimilarity.toFixed(2)}%`);
  console.log(`区域相似度范围: ${minSimilarity.toFixed(2)}% - ${maxSimilarity.toFixed(2)}%`);
  console.log(`加权相似度: ${weightedSimilarity.toFixed(2)}%`);

  // 如果加权相似度低于阈值，更新上一张图片的哈希值
  if (weightedSimilarity < duplicateThreshold) {
    lastRegionHashes = regionHashes;
    lastImageHash = regionHashes.globalHash; // 兼容原有代码
  }

  // 判断是否为重复图片
  const isDuplicate = weightedSimilarity >= duplicateThreshold;

  if (isDuplicate) {
    skippedDuplicates++;
    updateSkippedCount();
  }

  return isDuplicate;
}

// 计算图像的区域哈希值
function calculateRegionHashes(canvas, ctx) {
  // 先计算全局哈希值
  const globalHash = calculateImageHash(canvas, ctx);

  // 将图像分为3x3的网格
  const regionWidth = canvas.width / 3;
  const regionHeight = canvas.height / 3;

  const regions = [];

  // 计算每个区域的哈希值
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      // 创建临时画布来存储区域图像
      const regionCanvas = document.createElement('canvas');
      regionCanvas.width = regionWidth;
      regionCanvas.height = regionHeight;
      const regionCtx = regionCanvas.getContext('2d');

      // 将区域图像绘制到临时画布上
      regionCtx.drawImage(
        canvas,
        x * regionWidth, y * regionHeight, regionWidth, regionHeight,
        0, 0, regionWidth, regionHeight
      );

      // 计算区域哈希值
      const regionHash = calculateImageHash(regionCanvas, regionCtx);
      regions.push(regionHash);
    }
  }

  return {
    globalHash: globalHash,
    regions: regions
  };
}

// 全局变量来存储上一张图片的区域哈希值
var lastRegionHashes = null;

// 显示审核面板
function showReviewPanel() {
  // 如果没有截图，不显示审核面板
  if (capturedImages.length === 0) {
    alert('没有截图可以审核');
    return;
  }

  // 检查是否已经存在审核面板
  let reviewPanel = document.getElementById('screenshot-review-panel');
  if (reviewPanel) {
    // 如果已经存在，则更新内容
    reviewPanel.innerHTML = createReviewPanelContent();
    reviewPanel.style.display = 'flex';
  } else {
    // 创建审核面板
    reviewPanel = document.createElement('div');
    reviewPanel.id = 'screenshot-review-panel';
    reviewPanel.className = 'review-panel';
    reviewPanel.innerHTML = createReviewPanelContent();
    document.body.appendChild(reviewPanel);

    // 显示审核面板
    reviewPanel.style.display = 'flex';
  }

  // 添加事件监听器
  addReviewPanelEventListeners();
}

// 创建审核面板内容
function createReviewPanelContent() {
  let content = `
    <div class="review-panel-header">
      <h2 class="review-panel-title">截图审核</h2>
      <p class="review-panel-subtitle">选择要保留的截图，未选中的截图将被删除</p>
    </div>
    <div class="review-panel-grid">
  `;

  // 添加每张截图
  capturedImages.forEach((image, index) => {
    content += `
      <div class="review-image-container ${image.selected ? 'selected' : ''}" data-index="${index}">
        <img class="review-image" src="${image.dataURL}" alt="截图 ${index + 1}">
        <input type="checkbox" class="review-checkbox" ${image.selected ? 'checked' : ''}>
        <div class="review-image-info">
          <p>截图 #${index + 1} - 视频 #${image.videoIndex + 1}</p>
          <p>时间: ${image.timestamp.toLocaleString()}</p>
        </div>
      </div>
    `;
  });

  content += `
    </div>
    <div class="review-panel-actions">
      <button class="review-button review-select-all" id="review-select-all">全选</button>
      <button class="review-button review-select-all" id="review-deselect-all">取消全选</button>
      <button class="review-button review-confirm" id="review-confirm">确认并合并</button>
      <button class="review-button review-cancel" id="review-cancel">取消</button>
    </div>
  `;

  return content;
}

// 添加审核面板事件监听器
function addReviewPanelEventListeners() {
  // 图片容器点击事件
  const containers = document.querySelectorAll('.review-image-container');
  containers.forEach(container => {
    container.addEventListener('click', function(e) {
      // 如果点击的是复选框，不处理
      if (e.target.classList.contains('review-checkbox')) {
        return;
      }

      const index = parseInt(this.dataset.index);
      const checkbox = this.querySelector('.review-checkbox');

      // 切换选中状态
      capturedImages[index].selected = !capturedImages[index].selected;
      checkbox.checked = capturedImages[index].selected;

      // 更新容器样式
      this.classList.toggle('selected');
    });
  });

  // 复选框点击事件
  const checkboxes = document.querySelectorAll('.review-checkbox');
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      const container = this.closest('.review-image-container');
      const index = parseInt(container.dataset.index);

      // 更新选中状态
      capturedImages[index].selected = this.checked;

      // 更新容器样式
      container.classList.toggle('selected', this.checked);
    });
  });

  // 全选按钮
  document.getElementById('review-select-all').addEventListener('click', function() {
    capturedImages.forEach(image => image.selected = true);

    // 更新UI
    document.querySelectorAll('.review-image-container').forEach(container => {
      container.classList.add('selected');
      container.querySelector('.review-checkbox').checked = true;
    });
  });

  // 取消全选按钮
  document.getElementById('review-deselect-all').addEventListener('click', function() {
    capturedImages.forEach(image => image.selected = false);

    // 更新UI
    document.querySelectorAll('.review-image-container').forEach(container => {
      container.classList.remove('selected');
      container.querySelector('.review-checkbox').checked = false;
    });
  });

  // 确认按钮
  document.getElementById('review-confirm').addEventListener('click', function() {
    // 检查是否有选中的图片
    const selectedCount = capturedImages.filter(img => img.selected).length;

    if (selectedCount === 0) {
      alert('请至少选择一张图片');
      return;
    }

    // 合并选中的图片
    mergeAndDownloadImages();

    // 关闭审核面板
    hideReviewPanel();

    // 停止审核按钮闪烁
    const reviewButton = document.getElementById('panel-review');
    if (reviewButton) {
      reviewButton.style.animation = 'none';
    }
  });

  // 取消按钮
  document.getElementById('review-cancel').addEventListener('click', hideReviewPanel);
}

// 隐藏审核面板
function hideReviewPanel() {
  const reviewPanel = document.getElementById('screenshot-review-panel');
  if (reviewPanel) {
    reviewPanel.style.display = 'none';
  }
}

// 使控制面板可拖拽
function makePanelDraggable() {
  const panel = document.getElementById('screenshot-control-panel');
  if (!panel) return;

  let isDragging = false;
  let offsetX, offsetY;

  // 从存储中获取之前保存的位置
  chrome.storage.local.get(['panelPosition'], function(result) {
    if (result.panelPosition) {
      panel.style.top = result.panelPosition.top + 'px';
      panel.style.right = 'auto';
      panel.style.left = result.panelPosition.left + 'px';
    }
  });

  // 鼠标按下事件
  panel.addEventListener('mousedown', function(e) {
    // 如果点击的是按钮或其他交互元素，不启动拖拽
    if (e.target.tagName === 'BUTTON' || e.target.id === 'panel-toggle' || e.target.parentElement.id === 'panel-toggle') {
      return;
    }

    isDragging = true;

    // 计算鼠标与面板左上角的偏移量
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    // 添加样式以指示正在拖拽
    panel.style.opacity = '0.8';
    panel.style.transition = 'none';

    // 防止文本选中
    e.preventDefault();
  });

  // 鼠标移动事件
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;

    // 计算新位置
    const newLeft = e.clientX - offsetX;
    const newTop = e.clientY - offsetY;

    // 限制面板不超出屏幕
    const maxX = window.innerWidth - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;

    panel.style.left = Math.max(0, Math.min(newLeft, maxX)) + 'px';
    panel.style.top = Math.max(0, Math.min(newTop, maxY)) + 'px';
    panel.style.right = 'auto';
  });

  // 鼠标松开事件
  document.addEventListener('mouseup', function() {
    if (!isDragging) return;

    isDragging = false;

    // 恢复样式
    panel.style.opacity = '1';
    panel.style.transition = 'opacity 0.3s ease';

    // 保存位置到存储
    const rect = panel.getBoundingClientRect();
    chrome.storage.local.set({
      panelPosition: {
        top: rect.top,
        left: rect.left
      }
    });
  });

  // 鼠标离开浏览器窗口事件
  document.addEventListener('mouseleave', function() {
    if (isDragging) {
      isDragging = false;
      panel.style.opacity = '1';
      panel.style.transition = 'opacity 0.3s ease';
    }
  });
}

// 添加消息监听器
  chrome.runtime.onMessage.addListener(function(request, _sender, sendResponse) {
    console.log('收到消息:', request.action);

    // 添加一个简单的ping处理，用于检查content.js是否已注入
    if (request.action === 'ping') {
      sendResponse({status: 'ok'});
      return true;
    }

    // 其他消息处理...
    switch (request.action) {
      case 'getVideoCount':
        sendResponse({videoCount: videoElements.length});
        break;

      case 'startCapture':
        startCapture(request.settings);
        sendResponse({success: true});
        break;

      case 'stopCapture':
        stopCapture();
        sendResponse({success: true});
        break;

      case 'startDetection':
        console.log('开始视频检测，最大尝试次数:', request.maxAttempts);
        if (request.maxAttempts) {
          maxDetectionAttempts = request.maxAttempts;
        }
        startContinuousDetection();
        sendResponse({success: true});
        break;

      case 'stopDetection':
        console.log('停止视频检测');
        stopContinuousDetection();
        sendResponse({success: true});
        break;

      case 'getStatus':
        sendResponse({
          isCapturing: captureInterval !== null,
          isPaused: capturePaused,
          captureCount: captureCount,
          videoDetected: videoElements.length > 0,
          videoCount: videoElements.length,
          isDetecting: isDetectionActive
        });
        break;
    }
    return true; // Keep the message channel open for async responses
  });

  // Initialize when the page is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})(); // 立即执行函数结束
