// 初始化计数器
let downloadCount = 0;

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener(function(request, _sender, sendResponse) {
  if (request.action === 'downloadScreenshot') {
    console.log('收到截图下载请求:', request.filename);

    try {
      // 直接使用Chrome下载API下载数据URL
      chrome.downloads.download({
        url: request.dataURL,
        filename: request.filename,
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(downloadId) {
        if (chrome.runtime.lastError) {
          console.log('下载过程中出错:', chrome.runtime.lastError.message);
          sendResponse({success: false, error: chrome.runtime.lastError.message});
        } else if (downloadId) {
          downloadCount++;
          console.log('截图下载成功:', request.filename);
          console.log('总共下载截图数:', downloadCount);
          sendResponse({success: true, downloadId: downloadId});
        } else {
          console.log('截图下载失败: 未知原因');
          sendResponse({success: false, error: '未知原因'});
        }
      });
    } catch (e) {
      console.log('处理截图时出错:', e.message);
      sendResponse({success: false, error: e.message});
    }

    return true; // 保持消息通道开放以进行异步响应
  }
  return true;
});
