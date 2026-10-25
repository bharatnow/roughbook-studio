<?php

use App\Http\Controllers\BlogController;
use App\Http\Controllers\PricingController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('home');
})->name('home');

Route::view('/about', 'pages.about')->name('about');
Route::get('/pricing', [PricingController::class, 'index'])->name('pricing');
Route::get('/blog/{post}', [BlogController::class, 'show'])->name('blog.post');
Route::get('/login', fn () => view('auth.login'))->name('login');

Route::middleware('auth')->group(function () {
    Route::get('/account', fn () => view('account'))->name('account');
});
