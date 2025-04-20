document.addEventListener('DOMContentLoaded', function() {
  // 标签页切换功能
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  // 添加标签页点击事件
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // 移除所有标签页的活动状态
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));

      // 激活当前点击的标签页
      button.classList.add('active');
      const tabId = button.getAttribute('data-tab');
      document.getElementById(`${tabId}-tab`).classList.add('active');
    });
  });

  // 状态监听器，用于同步控制面板和弹出窗口的状态
  chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'local') {
      console.log('存储变化:', changes);

      // 创建一个包含变化的对象
      const changedState = {};
      for (const key in changes) {
        changedState[key] = changes[key].newValue;
      }
      console.log('变化的状态:', changedState);

      // 检查是否有状态变化
      if (changes.isCapturing || changes.isPaused || changes.videoDetected || changes.videoCount) {
        console.log('检测到状态变化，直接使用变化的状态更新UI');
        // 直接使用变化的状态更新UI，而不是重新从存储中获取
        updateUIFromStorage(changedState);
      }

      // 如果是从控制面板停止截图，确保开始按钮可用
      if (changes.isCapturing && changes.isCapturing.newValue === false) {
        console.log('检测到截图停止，确保开始按钮可用');
        const startButton = document.getElementById('start-capture');
        if (startButton && changedState.videoDetected) {
          startButton.disabled = false;
        }
      }
    }
  });

  // 监听来自content script的消息
  chrome.runtime.onMessage.addListener(function(request, _sender, _sendResponse) {
    console.log('收到消息:', request);

    if (request.action === 'videoDetected') {
      // 已检测到视频
      console.log('检测到视频:', request.count);

      // 更新UI
      videoCountElement.textContent = `检测到的视频: ${request.count}`;
      statusElement.textContent = `状态: 已检测到 ${request.count} 个视频`;

      // 启用开始截图按钮
      startButton.disabled = false;

      // 禁用检测视频按钮
      detectButton.disabled = true;
      detectButton.textContent = '已检测到视频';

      // 更新提示文本
      buttonHintElement.textContent = '提示: 点击"开始截图"按钮开始截取视频画面';

      // 停止检测状态
      isDetecting = false;
      detectButton.classList.remove('detecting');

      // 将视频检测状态保存到存储中
      chrome.storage.local.set({videoDetected: true, videoCount: request.count});
    } else if (request.action === 'videoDetectionFailed') {
      // 未检测到视频
      console.log('未检测到视频');

      // 更新UI
      statusElement.textContent = '状态: 未检测到视频';

      // 停止检测状态
      isDetecting = false;
      detectButton.textContent = '检测视频';
      detectButton.classList.remove('detecting');
    } else if (request.action === 'updatePopupUI') {
      // 控制面板请求更新弹出窗口UI
      console.log('收到更新弹出窗口UI请求:', request.status);

      // 立即更新UI
      updatePopupUI();
    }

    return true;
  });

  // 监听标签页切换事件，在切换标签页时重置状态
  chrome.tabs.onActivated.addListener(function(activeInfo) {
    console.log('标签页切换，重置状态');
    resetState();
  });

  // 监听标签页导航事件，在导航到新页面时重置状态
  chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete') {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs && tabs.length > 0 && tabs[0].id === tabId) {
          console.log('当前标签页导航完成，重置状态');
          resetState();
        }
      });
    }
  });

  // 初始化时更新UI
  updatePopupUI();

  // Get UI elements
  const detectButton = document.getElementById('detect-videos');
  const startButton = document.getElementById('start-capture');
  const stopButton = document.getElementById('stop-capture');
  const intervalInput = document.getElementById('interval');
  const qualityInput = document.getElementById('quality');
  const formatSelect = document.getElementById('format');
  const mergeCountInput = document.getElementById('merge-count');
  const mergeFormatSelect = document.getElementById('merge-format');
  const keepOriginalsCheckbox = document.getElementById('keep-originals');
  const autoStopInput = document.getElementById('auto-stop');
  const enableAutoStopCheckbox = document.getElementById('enable-auto-stop');
  const duplicateThresholdInput = document.getElementById('duplicate-threshold');
  const enableDuplicateDetectionCheckbox = document.getElementById('enable-duplicate-detection');
  const statusElement = document.getElementById('status');
  const videoCountElement = document.getElementById('video-count');
  const buttonHintElement = document.getElementById('button-hint');

  // 检测视频相关变量
  let isDetecting = false;
  let maxDetectionAttempts = 30; // 最多尝试30次
  let isCapturing = false; // 跟踪截图状态

  // Load saved settings
  chrome.storage.local.get(['interval', 'quality', 'format', 'mergeCount', 'mergeFormat', 'keepOriginals', 'autoStopMinutes', 'enableAutoStop', 'duplicateThreshold', 'enableDuplicateDetection'], function(result) {
    console.log('加载保存的设置:', result);
    if (result.interval !== undefined) intervalInput.value = result.interval;
    if (result.quality !== undefined) qualityInput.value = result.quality;
    if (result.format !== undefined) formatSelect.value = result.format;
    if (result.mergeCount !== undefined) mergeCountInput.value = result.mergeCount;
    if (result.mergeFormat !== undefined) mergeFormatSelect.value = result.mergeFormat;
    if (result.keepOriginals !== undefined) keepOriginalsCheckbox.checked = result.keepOriginals;
    if (result.autoStopMinutes !== undefined) autoStopInput.value = result.autoStopMinutes;
    if (result.enableAutoStop !== undefined) enableAutoStopCheckbox.checked = result.enableAutoStop;
    if (result.duplicateThreshold !== undefined) duplicateThresholdInput.value = result.duplicateThreshold;
    if (result.enableDuplicateDetection !== undefined) enableDuplicateDetectionCheckbox.checked = result.enableDuplicateDetection;
  });

  // 当设置发生变化时自动保存
  intervalInput.addEventListener('change', saveSettings);
  qualityInput.addEventListener('change', saveSettings);
  formatSelect.addEventListener('change', saveSettings);
  mergeCountInput.addEventListener('change', saveSettings);
  mergeFormatSelect.addEventListener('change', saveSettings);
  keepOriginalsCheckbox.addEventListener('change', saveSettings);
  autoStopInput.addEventListener('change', saveSettings);
  enableAutoStopCheckbox.addEventListener('change', saveSettings);
  duplicateThresholdInput.addEventListener('change', saveSettings);
  enableDuplicateDetectionCheckbox.addEventListener('change', saveSettings);

  // 检测视频按钮点击事件
  detectButton.addEventListener('click', function() {
    if (isDetecting) {
      // 如果正在检测，则停止检测
      stopDetection();
    } else {
      // 否则先检查content.js是否已经注入，再开始检测
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) return;

        // 先检查content.js是否已经注入
        chrome.tabs.sendMessage(tabs[0].id, {action: 'ping'}, function(response) {
          if (chrome.runtime.lastError) {
            console.log('检测到content.js未注入，先注入脚本');
            // content.js未注入，先注入
            injectContentScript(tabs[0].id, function(success) {
              if (success) {
                // 注入成功后开始检测
                console.log('content.js注入成功，开始检测');
                setTimeout(function() {
                  startDetection();
                }, 500); // 等待脚本初始化
              } else {
                console.error('注入content.js失败，无法检测视频');
                statusElement.textContent = '状态: 无法检测视频，请刷新页面后重试';
                buttonHintElement.textContent = '提示: 无法检测视频，请刷新页面后重试';
              }
            });
          } else {
            // content.js已注入，直接开始检测
            console.log('content.js已注入，直接开始检测');
            startDetection();
          }
        });
      });
    }
  });

  // 开始检测视频
  function startDetection() {
    if (isDetecting) return;

    isDetecting = true;
    detectButton.textContent = '停止检测';
    detectButton.classList.add('detecting');
    statusElement.textContent = '状态: 正在检测视频...';

    // 更新提示文本
    buttonHintElement.textContent = '提示: 正在检测视频，请稍等...';

    // 发送消息给content script开始检测视频
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || tabs.length === 0) {
        console.log('无法获取当前标签页');
        stopDetection();
        return;
      }

      try {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'startDetection', maxAttempts: maxDetectionAttempts}, function(response) {
          // 检查runtime.lastError
          if (chrome.runtime.lastError) {
            console.log('发送消息错误:', chrome.runtime.lastError.message);
            // 尝试注入content script
            injectContentScript(tabs[0].id, function(success) {
              if (!success) {
                console.error('注入content script失败，无法检测视频');
                stopDetection();
                statusElement.textContent = '状态: 无法检测视频，请刷新页面后重试';
                buttonHintElement.textContent = '提示: 无法检测视频，请刷新页面后重试';
                return;
              }

              // 注入成功后重新发送消息
              setTimeout(function() {
                try {
                  chrome.tabs.sendMessage(tabs[0].id, {action: 'startDetection', maxAttempts: maxDetectionAttempts}, function(response) {
                    if (chrome.runtime.lastError) {
                      console.error('重新发送消息仍然失败:', chrome.runtime.lastError.message);
                      stopDetection();
                      statusElement.textContent = '状态: 无法检测视频，请刷新页面后重试';
                      buttonHintElement.textContent = '提示: 无法检测视频，请刷新页面后重试';
                    } else {
                      console.log('重新发送开始检测视频响应:', response);
                    }
                  });
                } catch (e) {
                  console.error('重新发送消息异常:', e);
                  stopDetection();
                }
              }, 500);
            });
          } else if (response) {
            console.log('开始检测视频响应:', response);
          }
        });
      } catch (error) {
        console.error('发送消息时出错:', error);
        // 尝试注入content script
        injectContentScript(tabs[0].id, function(success) {
          if (!success) {
            console.error('注入content script失败，无法检测视频');
            stopDetection();
            statusElement.textContent = '状态: 无法检测视频，请刷新页面后重试';
            buttonHintElement.textContent = '提示: 无法检测视频，请刷新页面后重试';
            return;
          }

          // 注入成功后重新发送消息
          setTimeout(function() {
            try {
              chrome.tabs.sendMessage(tabs[0].id, {action: 'startDetection', maxAttempts: maxDetectionAttempts}, function(response) {
                if (chrome.runtime.lastError) {
                  console.error('重新发送消息仍然失败:', chrome.runtime.lastError.message);
                  stopDetection();
                } else {
                  console.log('重新发送开始检测视频响应:', response);
                }
              });
            } catch (e) {
              console.error('重新发送消息异常:', e);
              stopDetection();
            }
          }, 500);
        });
      }
    });

    // 定期检查检测状态
    checkDetectionStatus();
  }

  // 停止检测视频
  function stopDetection() {
    if (!isDetecting) return;

    isDetecting = false;
    detectButton.textContent = '检测视频';
    detectButton.classList.remove('detecting');
    statusElement.textContent = '状态: 未启动';

    // 更新提示文本
    buttonHintElement.textContent = '提示: 请先点击"检测视频"按钮';

    // 发送消息给content script停止检测视频
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || tabs.length === 0) {
        console.log('无法获取当前标签页');
        return;
      }

      try {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'stopDetection'}, function(response) {
          // 检查runtime.lastError
          if (chrome.runtime.lastError) {
            console.log('发送停止检测消息错误:', chrome.runtime.lastError.message);
            // 已经停止了检测，不需要重试
          } else if (response) {
            console.log('停止检测视频响应:', response);
          }
        });
      } catch (error) {
        console.error('发送停止检测消息时出错:', error);
        // 已经停止了检测，不需要重试
      }
    });
  }

  // 检查检测状态
  function checkDetectionStatus() {
    if (!isDetecting) return;

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || tabs.length === 0) {
        console.log('无法获取当前标签页');
        stopDetection();
        return;
      }

      try {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'getStatus'}, function(response) {
          // 检查runtime.lastError
          if (chrome.runtime.lastError) {
            console.log('发送消息错误:', chrome.runtime.lastError.message);
            // 尝试注入content script
            injectContentScript(tabs[0].id, function(success) {
              if (!success) {
                console.error('注入content script失败，停止检测');
                stopDetection();
                return;
              }
              // 注入后等待一会再重试
              setTimeout(checkDetectionStatus, 500);
            });
            return;
          }

          if (response) {
            console.log('检测状态:', response);

            // 更新状态显示
            if (response.videoDetected || response.videoCount > 0) {
              // 如果找到视频，启用开始截图按钮，禁用检测视频按钮
              startButton.disabled = false;
              detectButton.disabled = true; // 禁用检测视频按钮
              statusElement.textContent = `状态: 已检测到 ${response.videoCount} 个视频`;
              videoCountElement.textContent = `检测到的视频: ${response.videoCount}`;

              // 更新提示文本
              buttonHintElement.textContent = '提示: 点击"开始截图"按钮开始截取视频画面';

              // 停止检测
              isDetecting = false;
              detectButton.textContent = '已检测到视频'; // 更改按钮文本
              detectButton.classList.remove('detecting');

              // 将视频检测状态保存到存储中
              chrome.storage.local.set({videoDetected: true, videoCount: response.videoCount});

              // 发送停止检测消息给content.js，确保检测已停止
              chrome.tabs.sendMessage(tabs[0].id, {action: 'stopDetection'});
              return;
            } else if (response.isDetecting === false || continuousDetectionCount >= maxDetectionAttempts) {
              // 如果检测已经停止或达到最大尝试次数，停止检测
              statusElement.textContent = '状态: 未检测到视频';

              // 更新提示文本
              buttonHintElement.textContent = '提示: 未检测到视频，请确认页面上有视频并重试';

              stopDetection();
            } else {
              // 继续检测
              continuousDetectionCount++;
              statusElement.textContent = `状态: 正在检测视频 (${continuousDetectionCount}/${maxDetectionAttempts})`;

              // 更新提示文本
              buttonHintElement.textContent = '提示: 正在检测视频，请稍等...';

              setTimeout(checkDetectionStatus, 1000);
            }
          } else {
            // 如果没有响应，可能是页面刷新或关闭，停止检测
            stopDetection();
          }
        });
      } catch (error) {
        console.error('发送消息时出错:', error);
        stopDetection();
      }
    });
  }

  // 注入content script
  function injectContentScript(tabId, callback) {
    console.log('正在注入content script...');
    try {
      // 检查当前标签页URL
      chrome.tabs.get(tabId, function(tab) {
        if (chrome.runtime.lastError) {
          console.error('获取标签页信息失败:', chrome.runtime.lastError.message);
          if (callback) callback(false);
          return;
        }

        // 检查URL是否是chrome-extension://
        if (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) {
          console.error('无法在扩展页面上注入脚本');
          if (callback) callback(false);
          return;
        }

        // 使用executeScript注入脚本
        chrome.scripting.executeScript({
          target: {tabId: tabId},
          files: ['content.js']
        }, function(results) {
          if (chrome.runtime.lastError) {
            console.error('注入content script失败:', chrome.runtime.lastError.message);
            if (callback) callback(false);
          } else {
            console.log('content script注入成功');
            if (callback) callback(true);
          }
        });
      });
    } catch (error) {
      console.error('注入content script时发生异常:', error);
      if (callback) callback(false);
    }
  }

  // 保存设置函数
  function saveSettings() {
    const interval = parseFloat(intervalInput.value);
    const quality = parseInt(qualityInput.value);
    const format = formatSelect.value;
    const mergeCount = parseInt(mergeCountInput.value);
    const mergeFormat = mergeFormatSelect.value;
    const keepOriginals = keepOriginalsCheckbox.checked;
    const autoStopMinutes = parseInt(autoStopInput.value);
    const enableAutoStop = enableAutoStopCheckbox.checked;
    const duplicateThreshold = parseInt(duplicateThresholdInput.value);
    const enableDuplicateDetection = enableDuplicateDetectionCheckbox.checked;

    chrome.storage.local.set({
      interval: interval,
      quality: quality,
      format: format,
      mergeCount: mergeCount,
      mergeFormat: mergeFormat,
      keepOriginals: keepOriginals,
      autoStopMinutes: autoStopMinutes,
      enableAutoStop: enableAutoStop,
      duplicateThreshold: duplicateThreshold,
      enableDuplicateDetection: enableDuplicateDetection
    }, function() {
      console.log('设置已保存:', {
        interval: interval,
        quality: quality,
        format: format,
        mergeCount: mergeCount,
        mergeFormat: mergeFormat,
        keepOriginals: keepOriginals,
        autoStopMinutes: autoStopMinutes,
        enableAutoStop: enableAutoStop,
        duplicateThreshold: duplicateThreshold,
        enableDuplicateDetection: enableDuplicateDetection
      });
    });
  }

  // 默认禁用开始截图按钮，直到检测到视频
  startButton.disabled = true;

  // 检查当前截图状态和视频检测状态
  chrome.storage.local.get(['isCapturing', 'videoDetected', 'videoCount'], function(result) {
    if (result.isCapturing) {
      isCapturing = true; // 设置全局截图状态
      statusElement.textContent = '状态: 正在截图';
      startButton.disabled = true;
      stopButton.disabled = false;
      detectButton.disabled = true; // 在截图时禁用检测按钮
    } else {
      isCapturing = false; // 确保初始状态正确

      // 检查是否已经检测到视频
      if (result.videoDetected) {
        // 如果已经检测到视频，启用开始截图按钮，禁用检测视频按钮
        startButton.disabled = false;
        detectButton.disabled = true;
        detectButton.textContent = '已检测到视频';
        statusElement.textContent = `状态: 已检测到 ${result.videoCount || 0} 个视频`;
        videoCountElement.textContent = `检测到的视频: ${result.videoCount || 0}`;
        buttonHintElement.textContent = '提示: 点击"开始截图"按钮开始截取视频画面';
      }
    }
  });

  // 初始化时不自动获取视频数量，需要用户点击"检测视频"按钮
  // 设置初始状态
  videoCountElement.textContent = `检测到的视频: 0`;
  startButton.disabled = true; // 确保开始截图按钮初始时禁用

  // 更新弹出窗口UI以反映当前状态
  function updatePopupUI() {
    console.log('更新弹出窗口UI');

    // 直接从存储中获取完整状态，简化逻辑
    chrome.storage.local.get(null, function(state) {
      console.log('从存储中获取到的完整状态:', state);

      // 检查当前标签页是否有效
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) {
          console.log('无法获取当前标签页，重置状态');
          resetState();
          return;
        }

        // 检查当前标签页URL
        chrome.tabs.get(tabs[0].id, function(tab) {
          if (chrome.runtime.lastError) {
            console.error('获取标签页信息失败:', chrome.runtime.lastError.message);
            updateUIFromStorage(state);
            return;
          }

          // 检查URL是否是chrome-extension://
          if (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) {
            console.log('当前标签页是扩展页面，使用存储中的状态');
            updateUIFromStorage(state);
            return;
          }

          // 尝试从当前标签页获取最新状态
          try {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'getStatus'}, function(response) {
              // 检查runtime.lastError
              if (chrome.runtime.lastError) {
                console.log('发送getStatus消息错误:', chrome.runtime.lastError.message);
                // 直接使用存储中的状态
                updateUIFromStorage(state);
                return;
              }

              if (response) {
                console.log('从内容脚本获取状态:', response);
                // 合并内容脚本状态和存储状态
                const mergedState = {...state, ...response};
                // 确保视频检测状态正确
                if (state.videoDetected) {
                  mergedState.videoDetected = true;
                  mergedState.videoCount = state.videoCount || 0;
                }
                updateUIFromStorage(mergedState);
              } else {
                // 如果无法从内容脚本获取状态，则使用存储中的状态
                console.log('无法从内容脚本获取状态，使用存储中的状态');
                updateUIFromStorage(state);
              }
            });
          } catch (error) {
            console.error('发送消息时出错:', error);
            // 直接使用存储中的状态
            updateUIFromStorage(state);
          }
        });
      });
    });
  }

  // 从存储中更新UI
  function updateUIFromStorage(result = {}) {
    const startButton = document.getElementById('start-capture');
    const stopButton = document.getElementById('stop-capture');
    const statusElement = document.getElementById('status');
    const videoCountElement = document.getElementById('video-count');
    const detectButton = document.getElementById('detect-videos');
    const buttonHintElement = document.getElementById('button-hint');

    console.log('从存储中更新UI - 输入参数:', result);

    // 直接获取所有状态，避免嵌套调用
    chrome.storage.local.get(null, function(state) {
      console.log('获取完整状态:', state);

      // 合并结果，确保传入的参数优先级更高
      state = {...state, ...result};

      // 输出当前状态的关键变量
      console.log('当前状态:', {
        isCapturing: state.isCapturing,
        isPaused: state.isPaused,
        videoDetected: state.videoDetected,
        videoCount: state.videoCount
      });

      // 检查当前标签页是否有效
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) {
          console.log('无法获取当前标签页，重置状态');
          // 如果无法获取当前标签页，重置状态
          resetState();
          return;
        }

        if (state.isCapturing) {
          // 正在截图
          startButton.disabled = true;
          stopButton.disabled = false;
          detectButton.disabled = true; // 在截图时禁用检测按钮
          detectButton.textContent = '已检测到视频';

          if (state.isPaused) {
            // 已暂停
            statusElement.textContent = '状态: 已暂停';
          } else {
            // 正在进行
            statusElement.textContent = '状态: 正在截图';
          }

          buttonHintElement.textContent = '提示: 正在截图，可以点击"停止截图"按钮停止';
        } else {
          // 未在截图
          stopButton.disabled = true;

          if (state.videoDetected) {
            // 如果已经检测到视频，启用开始截图按钮，禁用检测视频按钮
            startButton.disabled = false;
            detectButton.disabled = true;
            detectButton.textContent = '已检测到视频';
            statusElement.textContent = `状态: 已检测到 ${state.videoCount || 0} 个视频`;
            videoCountElement.textContent = `检测到的视频: ${state.videoCount || 0}`;
            buttonHintElement.textContent = '提示: 点击"开始截图"按钮开始截取视频画面';
          } else {
            // 如果未检测到视频，禁用开始截图按钮，启用检测视频按钮
            startButton.disabled = true;
            detectButton.disabled = false;
            detectButton.textContent = '检测视频';
            statusElement.textContent = '状态: 未启动';

            // 检查是否在检测视频过程中
            if (isDetecting) {
              buttonHintElement.textContent = '提示: 正在检测视频，请稍等...';
            } else {
              buttonHintElement.textContent = '提示: 请先点击"检测视频"按钮';
            }
          }
        }

        // 更新截图计数
        if (state.captureCount !== undefined) {
          videoCountElement.textContent = `已截图: ${state.captureCount}`;
        }
      });
    });
  }

  // 重置状态函数，在标签页切换或其他需要重置状态的情况下调用
  function resetState() {
    console.log('重置状态');
    const startButton = document.getElementById('start-capture');
    const stopButton = document.getElementById('stop-capture');
    const statusElement = document.getElementById('status');
    const videoCountElement = document.getElementById('video-count');
    const detectButton = document.getElementById('detect-videos');
    const buttonHintElement = document.getElementById('button-hint');

    // 重置按钮状态
    startButton.disabled = true;
    stopButton.disabled = true;
    detectButton.disabled = false;
    detectButton.textContent = '检测视频';

    // 重置状态文本
    statusElement.textContent = '状态: 未启动';
    videoCountElement.textContent = '检测到的视频: 0';
    buttonHintElement.textContent = '提示: 请先点击"检测视频"按钮';

    // 重置存储状态
    chrome.storage.local.set({
      isCapturing: false,
      isPaused: false,
      videoDetected: false,
      videoCount: 0,
      captureCount: 0
    });

    // 重置全局状态
    isCapturing = false;
    isDetecting = false;
  }

  // Start capture button click handler
  startButton.addEventListener('click', function() {
    console.log('点击开始截图按钮');

    // 如果按钮被禁用或已经在截图，不执行操作
    if (this.disabled || isCapturing) {
      console.log('开始截图按钮已禁用或已在截图，忽略点击');
      return;
    }

    // 设置截图状态
    isCapturing = true;
    // 立即禁用开始按钮
    startButton.disabled = true;

    // 更新提示文本
    buttonHintElement.textContent = '提示: 正在截图，可以点击"停止截图"按钮停止';
    // Save settings
    const interval = parseFloat(intervalInput.value);
    const quality = parseInt(qualityInput.value);
    const format = formatSelect.value;
    const mergeCount = parseInt(mergeCountInput.value);
    const mergeFormat = mergeFormatSelect.value;
    const keepOriginals = keepOriginalsCheckbox.checked;
    const autoStopMinutes = parseInt(autoStopInput.value);
    const enableAutoStop = enableAutoStopCheckbox.checked;
    const duplicateThreshold = parseInt(duplicateThresholdInput.value);
    const enableDuplicateDetection = enableDuplicateDetectionCheckbox.checked;

    // 先保存设置，然后设置isCapturing状态
    chrome.storage.local.set({
      interval: interval,
      quality: quality,
      format: format,
      mergeCount: mergeCount,
      mergeFormat: mergeFormat,
      keepOriginals: keepOriginals,
      autoStopMinutes: autoStopMinutes,
      enableAutoStop: enableAutoStop,
      duplicateThreshold: duplicateThreshold,
      enableDuplicateDetection: enableDuplicateDetection
    }, function() {
      console.log('开始截图前保存设置成功');

      // 设置截图状态
      chrome.storage.local.set({
        isCapturing: true,
        isPaused: false,
        videoDetected: true // 确保视频检测状态保持为true
      });

      console.log('开始截图使用的设置:', {
        interval: interval,
        quality: quality,
        format: format,
        mergeCount: mergeCount,
        mergeFormat: mergeFormat,
        keepOriginals: keepOriginals,
        autoStopMinutes: autoStopMinutes,
        enableAutoStop: enableAutoStop
      });
    });

    // Send message to content script to start capturing
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || tabs.length === 0) {
        console.log('无法获取当前标签页');
        return;
      }

      // 检查当前标签页URL
      chrome.tabs.get(tabs[0].id, function(tab) {
        if (chrome.runtime.lastError) {
          console.error('获取标签页信息失败:', chrome.runtime.lastError.message);
          statusElement.textContent = '状态: 无法获取标签页信息';
          buttonHintElement.textContent = '提示: 请刷新页面后重试';
          return;
        }

        // 检查URL是否是chrome-extension://
        if (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) {
          console.error('无法在扩展页面上截图');
          statusElement.textContent = '状态: 无法在扩展页面上截图';
          buttonHintElement.textContent = '提示: 请在网页上使用此功能';
          return;
        }

        console.log('发送开始截图消息到内容脚本');
        try {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'startCapture',
            settings: {
              interval: interval,
              quality: quality,
              format: format,
              mergeCount: mergeCount,
              mergeFormat: mergeFormat,
              keepOriginals: keepOriginals,
              autoStopMinutes: autoStopMinutes,
              enableAutoStop: enableAutoStop,
              duplicateThreshold: duplicateThreshold,
              enableDuplicateDetection: enableDuplicateDetection
            }
          }, function(response) {
            // 检查runtime.lastError
            if (chrome.runtime.lastError) {
              console.log('发送开始截图消息错误:', chrome.runtime.lastError.message);
              // 尝试注入content script
              injectContentScript(tabs[0].id, function(success) {
                if (!success) {
                  console.error('注入content script失败，无法开始截图');
                  statusElement.textContent = '状态: 无法开始截图，请刷新页面后重试';
                  buttonHintElement.textContent = '提示: 无法开始截图，请刷新页面后重试';
                  return;
                }

                // 注入成功后重新发送消息
                setTimeout(function() {
                  try {
                    chrome.tabs.sendMessage(tabs[0].id, {
                      action: 'startCapture',
                      settings: {
                        interval: interval,
                        quality: quality,
                        format: format,
                        mergeCount: mergeCount,
                        mergeFormat: mergeFormat,
                        keepOriginals: keepOriginals,
                        autoStopMinutes: autoStopMinutes,
                        enableAutoStop: enableAutoStop,
                        duplicateThreshold: duplicateThreshold,
                        enableDuplicateDetection: enableDuplicateDetection
                      }
                    }, function(response) {
                      if (chrome.runtime.lastError) {
                        console.error('重新发送消息仍然失败:', chrome.runtime.lastError.message);
                        statusElement.textContent = '状态: 无法开始截图，请刷新页面后重试';
                        buttonHintElement.textContent = '提示: 无法开始截图，请刷新页面后重试';
                      } else {
                        console.log('重新发送开始截图消息响应:', response);
                        // 强制更新控制面板状态
                        try {
                          chrome.tabs.sendMessage(tabs[0].id, {
                            action: 'updateControlPanel',
                            status: 'active'
                          });
                        } catch (e) {
                          console.error('更新控制面板状态失败:', e);
                        }
                      }
                    });
                  } catch (e) {
                    console.error('重新发送消息异常:', e);
                    statusElement.textContent = '状态: 无法开始截图，请刷新页面后重试';
                    buttonHintElement.textContent = '提示: 无法开始截图，请刷新页面后重试';
                  }
                }, 500);
              });
              return;
            }

            console.log('开始截图消息响应:', response);
            // 强制更新控制面板状态
            try {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: 'updateControlPanel',
                status: 'active'
              });
            } catch (e) {
              console.error('更新控制面板状态失败:', e);
            }
          });
        } catch (error) {
          console.error('发送开始截图消息时出错:', error);
          // 尝试注入content script
          injectContentScript(tabs[0].id, function(success) {
            if (!success) {
              console.error('注入content script失败，无法开始截图');
              statusElement.textContent = '状态: 无法开始截图，请刷新页面后重试';
              buttonHintElement.textContent = '提示: 无法开始截图，请刷新页面后重试';
              return;
            }

            // 注入成功后重新发送消息
            setTimeout(function() {
              try {
                chrome.tabs.sendMessage(tabs[0].id, {
                  action: 'startCapture',
                  settings: {
                    interval: interval,
                    quality: quality,
                    format: format,
                    mergeCount: mergeCount,
                    mergeFormat: mergeFormat,
                    keepOriginals: keepOriginals,
                    autoStopMinutes: autoStopMinutes,
                    enableAutoStop: enableAutoStop,
                    duplicateThreshold: duplicateThreshold,
                    enableDuplicateDetection: enableDuplicateDetection
                  }
                }, function(response) {
                  if (chrome.runtime.lastError) {
                    console.error('重新发送消息仍然失败:', chrome.runtime.lastError.message);
                    statusElement.textContent = '状态: 无法开始截图，请刷新页面后重试';
                    buttonHintElement.textContent = '提示: 无法开始截图，请刷新页面后重试';
                  } else {
                    console.log('重新发送开始截图消息响应:', response);
                  }
                });
              } catch (e) {
                console.error('重新发送开始截图消息失败:', e);
                statusElement.textContent = '状态: 无法开始截图，请刷新页面后重试';
                buttonHintElement.textContent = '提示: 无法开始截图，请刷新页面后重试';
              }
            }, 500);
          });
        }
      });
    });

    // Update UI
    statusElement.textContent = '状态: 正在截图';
    startButton.disabled = true;
    stopButton.disabled = false;
  });

  // Stop capture button click handler
  stopButton.addEventListener('click', function() {
    console.log('点击停止截图按钮');

    // 如果按钮被禁用或没有在截图，不执行操作
    if (this.disabled || !isCapturing) {
      console.log('停止截图按钮已禁用或没有在截图，忽略点击');
      return;
    }

    // 重置截图状态
    isCapturing = false;

    // 更新提示文本
    buttonHintElement.textContent = '提示: 截图已停止，可以重新点击"检测视频"按钮';

    // 设置状态为非截图状态
    chrome.storage.local.set({isCapturing: false, isPaused: false}, function() {
      console.log('截图状态已设置为停止');

      // Send message to content script to stop capturing
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) {
          console.log('无法获取当前标签页');
          return;
        }

        // 检查当前标签页URL
        chrome.tabs.get(tabs[0].id, function(tab) {
          if (chrome.runtime.lastError) {
            console.error('获取标签页信息失败:', chrome.runtime.lastError.message);
            // 即使无法获取标签页信息，也要重置状态
            updateUIAfterStop();
            return;
          }

          // 检查URL是否是chrome-extension://
          if (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) {
            console.log('当前标签页是扩展页面，直接重置状态');
            updateUIAfterStop();
            return;
          }

          try {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'stopCapture'}, function(response) {
              // 检查runtime.lastError
              if (chrome.runtime.lastError) {
                console.log('发送停止截图消息错误:', chrome.runtime.lastError.message);
                // 尝试注入content script
                injectContentScript(tabs[0].id, function(success) {
                  if (!success) {
                    console.error('注入content script失败，直接重置状态');
                    updateUIAfterStop();
                    return;
                  }

                  // 注入成功后重新发送消息
                  setTimeout(function() {
                    try {
                      chrome.tabs.sendMessage(tabs[0].id, {action: 'stopCapture'}, function(response) {
                        if (chrome.runtime.lastError) {
                          console.error('重新发送停止消息仍然失败:', chrome.runtime.lastError.message);
                        } else {
                          console.log('重新发送停止截图消息响应:', response);
                          // 强制更新控制面板状态
                          try {
                            chrome.tabs.sendMessage(tabs[0].id, {
                              action: 'updateControlPanel',
                              status: 'stopped'
                            });
                          } catch (e) {
                            console.error('更新控制面板状态失败:', e);
                          }
                        }
                        // 无论成功与否，都更新UI
                        updateUIAfterStop();
                      });
                    } catch (e) {
                      console.error('重新发送停止截图消息异常:', e);
                      updateUIAfterStop();
                    }
                  }, 500);
                });
                return;
              }

              console.log('停止截图响应:', response);

              // 强制更新控制面板状态
              try {
                chrome.tabs.sendMessage(tabs[0].id, {
                  action: 'updateControlPanel',
                  status: 'stopped'
                });
              } catch (e) {
                console.error('更新控制面板状态失败:', e);
              }

              // 更新UI
              updateUIAfterStop();
            });
          } catch (error) {
            console.error('发送停止截图消息时出错:', error);
            // 尝试注入content script
            injectContentScript(tabs[0].id, function(success) {
              if (!success) {
                console.error('注入content script失败，直接重置状态');
                updateUIAfterStop();
                return;
              }

              // 注入成功后重新发送消息
              setTimeout(function() {
                try {
                  chrome.tabs.sendMessage(tabs[0].id, {action: 'stopCapture'}, function(response) {
                    if (chrome.runtime.lastError) {
                      console.error('重新发送停止消息仍然失败:', chrome.runtime.lastError.message);
                    } else {
                      console.log('重新发送停止截图消息响应:', response);
                    }
                    // 无论成功与否，都更新UI
                    updateUIAfterStop();
                  });
                } catch (e) {
                  console.error('重新发送停止截图消息异常:', e);
                  updateUIAfterStop();
                }
              }, 500);
            });
          }
        });
      });

      // 停止截图后更新UI的函数
      function updateUIAfterStop() {
        // Update UI
        statusElement.textContent = '状态: 未启动';
        stopButton.disabled = true;

        // 停止截图后，保持视频检测状态，使开始按钮保持可用
        chrome.storage.local.get(['videoDetected', 'videoCount'], function(result) {
          if (result.videoDetected) {
            // 如果之前检测到了视频，保持开始按钮可用
            startButton.disabled = false;
            detectButton.disabled = true;
            detectButton.textContent = '已检测到视频';
            buttonHintElement.textContent = '提示: 点击"开始截图"按钮开始截取视频画面';
          } else {
            // 如果之前没有检测到视频，启用检测按钮
            startButton.disabled = true;
            detectButton.disabled = false;
            detectButton.textContent = '检测视频';
            buttonHintElement.textContent = '提示: 请先点击"检测视频"按钮';
          }
        });
      }

      // Update UI
      statusElement.textContent = '状态: 未启动';
      stopButton.disabled = true;

      // 停止截图后，保持视频检测状态，使开始按钮保持可用
      chrome.storage.local.get(['videoDetected', 'videoCount'], function(result) {
        if (result.videoDetected) {
          // 如果之前检测到了视频，保持开始按钮可用
          startButton.disabled = false;
          detectButton.disabled = true;
          detectButton.textContent = '已检测到视频';
          buttonHintElement.textContent = '提示: 点击"开始截图"按钮开始截取视频画面';
        } else {
          // 如果之前没有检测到视频，启用检测按钮
          startButton.disabled = true;
          detectButton.disabled = false;
          detectButton.textContent = '检测视频';
          buttonHintElement.textContent = '提示: 请先点击"检测视频"按钮';
        }
      });
    });
  });
});
