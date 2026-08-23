import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { APP_NAME } from '../../shared/config';
import { createPost, postCommentsUrl } from '../core/post';

type PublishFormValues = {
  title?: string;
};

export const forms = new Hono();

forms.post('/publish-submit', async (c) => {
  try {
    const body = await c.req.json<PublishFormValues>().catch(() => ({} as PublishFormValues));
    const post = await createPost(body.title);

    return c.json<UiResponse>(
      {
        showToast: `Your ${APP_NAME} post is ready!`,
        navigateTo: postCommentsUrl(context.subredditName, post.id),
      },
      200
    );
  } catch (error) {
    console.error('Publish form error:', error);
    return c.json<UiResponse>(
      {
        showToast: 'Could not make the post',
      },
      400
    );
  }
});
