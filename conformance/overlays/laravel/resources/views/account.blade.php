@extends('layouts.app')

@section('title', 'Your account')

@section('content')
    <section>
        <h1>Hello, {{ auth()->user()->name }}</h1>
    </section>
@endsection
