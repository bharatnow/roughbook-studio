@extends('layouts.app')

@section('title', $post['title'])

@section('content')
    <article>
        <h1>{{ $post['title'] }}</h1>
        <p>{{ $post['body'] }}</p>
    </article>
@endsection
