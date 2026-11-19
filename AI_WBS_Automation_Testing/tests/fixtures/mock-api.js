export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function mockFetch({ documents = [], uploadStatus = 200 } = {}) {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/api/documents') && (!options.method || options.method === 'GET')) {
      return jsonResponse({ success: true, documents });
    }
    if (String(url).includes('/api/documents') && options.method === 'POST') {
      return jsonResponse(
        uploadStatus === 200
          ? { success: true, message: 'Đã nạp thành công tài liệu', docId: 'doc-test-1', chunkCount: 1 }
          : { success: false, error: 'Không thể nạp tài liệu' },
        uploadStatus
      );
    }
    if (String(url).includes('/api/documents/') && options.method === 'DELETE') {
      return jsonResponse({ success: true, message: 'Đã xóa tài liệu' });
    }
    if (String(url).includes('/api/breakdown') && options.method === 'POST') {
      return jsonResponse({
        success: true,
        tasks: [{
          title: 'Thiết kế API đăng nhập',
          description: 'Xây dựng API xác thực người dùng',
          role: 'Backend Developer',
          priority: 'High',
          subtasks: ['Thiết kế endpoint', 'Viết unit test'],
          assignee: '',
          estimatedHours: 8,
          sprint: 'Sprint 1',
          startDate: '2026-11-09',
          dueDate: '2026-11-12'
        }],
        ragMetadata: { usedRag: false, matchedChunks: [] }
      });
    }
    return jsonResponse({ success: true, documents: [] });
  };
  return { fetchMock, calls };
}
