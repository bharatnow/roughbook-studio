@extends('layouts.app')

@section('title', 'Sign in')

@section('content')
    <form method="post" action="/login">
        <x-input name="email" type="email" />
        <button type="submit">Sign in</button>
    </form>
@endsection
