<?php

namespace App\Http\Controllers;

class BlogController extends Controller
{
    private const POSTS = [
        'hello-world' => ['title' => 'Hello, world', 'body' => 'Harbor is open.'],
        'second-post' => ['title' => 'What we learned', 'body' => 'Plans change.'],
    ];

    public function show(string $post)
    {
        abort_unless(isset(self::POSTS[$post]), 404);

        return view('blog.post', ['post' => self::POSTS[$post]]);
    }
}
