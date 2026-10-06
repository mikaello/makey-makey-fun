export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);

    if (
      request.method === 'GET' &&
      response.ok &&
      request.headers.get('accept')?.includes('text/html')
    ) {
      console.log({ event: 'page_view' });
    }

    return response;
  },
};
